// schema v1 → v2 的数据迁移（在 v2.sql 的同一个事务里执行）。
//
// 迁移只做「旧格式 → 新结构」的转换，不做运行时兼容：
//   1. manifest.json 附件台账 → attachments 表（本机仓 + 云端镜像）；
//   2. 旧 refs 的非 md 行：能识别的转成 attachment，不能识别的保留为 md（不丢数据）；
//   3. 全量任务正文 → task_attach（正文里的 fileId / nxkv 链接 / URL 一次性落关系）；
//   4. docs 树全量 → refs + ref_attach（文档资源可查）。
//
// 幂等：全部是 INSERT ... ON CONFLICT / 整组重写，重复执行结果一致。
// 失败：由 migrator 的 step 事务整体回滚，user_version 停在 1，库仍可用。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureUrlAttachment,
  syncDocAttachmentIndex,
  syncTaskAttachmentIndex,
  upsertFileAttachment,
} from '../../attachmentdb.js';
import { readSettingRaw } from '../settings.js';
import type { DbApi } from '../driver.js';

/** 迁移上下文（bootstrap 传入）。 */
export interface V2Context {
  attachmentsRoot?: string;
  docsRoot?: string;
  atMs?: number;
}

/** manifest 目录项。 */
interface ManifestDir {
  dir: string;
  storage: string;
  groupId: number;
}

/** step 002 的结果。 */
export interface AttachmentsMigrationResult {
  manifestCount: number;
  taskEdges: any;
  docEdges: any;
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function manifestDirs(root: string | undefined, overrideDir: string | undefined): ManifestDir[] {
  const out: ManifestDir[] = [];
  const add = (dir: string, storage: string, groupId: unknown): void => {
    if (!dir) return;
    out.push({ dir, storage, groupId: Number(groupId) || 0 });
  };
  add(join(root as string, 'local'), 'local', 0);
  if (root && existsSync(root)) {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'local') add(join(root, e.name), 'cloud', Number(e.name) || 0);
    }
  }
  // attachmentsDir 覆盖只作用于云端镜像；它也可能有自己的 <groupId> 子目录。
  if (overrideDir && existsSync(overrideDir)) {
    for (const e of readdirSync(overrideDir, { withFileTypes: true })) {
      if (e.isDirectory()) add(join(overrideDir, e.name), 'cloud', Number(e.name) || 0);
    }
    // 老版本在覆盖目录下也可能直接放 manifest.json（groupId 写在文件里）
    add(overrideDir, 'cloud', 0);
  }
  // 去重（同一目录可能被 root/override 各扫一次）
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.dir.replace(/\\/g, '/').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function manifestFilesIn(dir: string): string[] {
  const out: string[] = [];
  const main = join(dir, 'manifest.json');
  if (existsSync(main)) out.push(main);
  // 上一次迁移可能已把台账归档成 manifest.migrated-<tag>.json；迁移事务若失败回滚，
  // 主文件名不在，但数据还在归档里——继续读它，避免「回滚一次就丢台账」。
  try {
    for (const name of readdirSync(dir)) {
      if (/^manifest\.migrated-.*\.json$/i.test(name)) out.push(join(dir, name));
    }
  } catch {
    // 目录不存在 → 无台账
  }
  return out;
}

function migrateManifests(
  conn: DbApi,
  { attachmentsRoot, overrideDir, atMs }: { attachmentsRoot: string | undefined; overrideDir: string; atMs: number }
): number {
  let count = 0;
  for (const item of manifestDirs(attachmentsRoot, overrideDir)) {
    for (const manifestPath of manifestFilesIn(item.dir)) {
      const data = readJson(manifestPath);
      if (!data || !data.files || typeof data.files !== 'object') continue;
      for (const [fileId, rec] of Object.entries(data.files)) {
        if (!rec || typeof rec !== 'object') continue;
        const name = String((rec as any).name || '');
        const localPath = name ? join(String(data.dir || item.dir), name) : String(data.dir || item.dir);
        try {
          // 同一目录既有 manifest.json 又有归档时按 id upsert：不会重复计数。
          const existed = conn.get('SELECT 1 FROM attachments WHERE id = :id', { id: fileId });
          upsertFileAttachment(conn, {
            id: fileId,
            name,
            localPath,
            mime: String((rec as any).contentType || ''),
            size: Number((rec as any).size) || 0,
            storage: item.storage,
            groupId: Number(data.groupId) || item.groupId || 0,
            meta: {
              legacyManifest: true,
              syncedAt: (rec as any).syncedAt || (rec as any).createdAt || '',
            },
            atMs,
          });
          if (!existed) count += 1;
        } catch {
          // manifest 里可能有非 fileId 的历史键：跳过并继续，不让一条脏键回滚整库迁移。
        }
      }
    }
  }
  return count;
}

function normalizeRefs(conn: DbApi, atMs: number): void {
  // 旧版 type='path' 是「外部 .md 绝对路径」，语义上仍是文档 → 归一到 md。
  conn.run("UPDATE refs SET type = 'md', updated_at = :at WHERE type <> 'md' AND lower(locator) LIKE '%.md'", { at: atMs });
  const rest = conn.all("SELECT id, locator FROM refs WHERE type <> 'md'");
  for (const r of rest) {
    const loc = String(r.locator || '').trim();
    if (/^https?:\/\//i.test(loc)) {
      ensureUrlAttachment(conn, { url: loc, name: loc, atMs });
    } else if (loc) {
      // 非 md 的外部文件（图片/PDF）：转成 file 资源，字节留在库外。
      // id 必须是合法 fileId（16+ hex）——用 locator 的 sha1 前 32 位，
      // 确定性生成，重复迁移得到同一行。
      const legacyId = createHash('sha1').update(loc, 'utf8').digest('hex').slice(0, 32);
      upsertFileAttachment(conn, {
        id: legacyId,
        name: loc.split(/[\\/]/).pop() || loc,
        localPath: loc,
        storage: 'local',
        meta: { legacyRefId: r.id, external: true },
        atMs,
      });
    }
    conn.run('DELETE FROM refs WHERE id = :id', { id: r.id });
  }
}

/**
 * step 002 的 apply。`ctx` 由 bootstrap 传入：{ attachmentsRoot, docsRoot, atMs }。
 */
export function migrateAttachments(
  conn: DbApi,
  { attachmentsRoot, docsRoot, atMs = Date.now() }: V2Context = {}
): AttachmentsMigrationResult {
  const overrideDir = String(readSettingRaw(conn, 'app.attachmentsDir') || '');
  const manifestCount = migrateManifests(conn, { attachmentsRoot, overrideDir, atMs });
  normalizeRefs(conn, atMs);
  const taskEdges = syncTaskAttachmentIndex(conn, { atMs });
  const docEdges = syncDocAttachmentIndex(conn, { docsRoot, atMs });
  return { manifestCount, taskEdges, docEdges };
}
