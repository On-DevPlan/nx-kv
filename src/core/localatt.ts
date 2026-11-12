// 本地附件仓：本机任务/文档的贴图与文件原件，字节落在本地磁盘，
// **元数据唯一真相在 SQLite 的 attachments 表**（schema v2）。
//
// 口径（任务 #15 验收反馈 2026-11-04 起，2026-11-08 收口到 DB）：
//   · 本地任务贴图走本地存储：上传不碰网、预览不透传、agent 领取直接读本地路径；
//   · 云端任务/图床已移除，这里只服务本地附件；
//   · 正文引用语法完全不变：`![名](fileId)` / `[名](fileId)`，fileId = attachments.id。
//
// 目录：~/.nx-kv/attachments/local/（NX_KV_ATTACHMENTS 可改根目录）。
// 旧的 manifest.json 只在 schema v1→v2 迁移时读取一次，之后归档；运行时不再写它，
// 杜绝「DB 与 JSON 两套真相」。
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, join, parse as parsePath } from 'node:path';
import { attachmentsRootFromEnv } from './paths.js';
import { contentTypeOf, localNameFor, safeFileName } from './filekind.js';
import { getDb } from './db/index.js';
import { getAttachment, upsertFileAttachment } from './attachmentdb.js';
import type { ReadStream } from 'node:fs';
import type { DbApi, Row } from './db/driver.js';

export const LOCAL_STORE_DIRNAME = 'local';

/** 本地仓的一个条目（上传 / 解析 / 索引共用同一形状）。 */
export interface LocalStoreEntry {
  fileId: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
  storage: 'local';
}

/** 上传结果（与条目同形）。 */
export type LocalUploadResult = LocalStoreEntry;

/** 本地仓索引（领取侧批量标注用）。 */
export interface LocalStoreIndex {
  dir: string;
  index: Map<string, LocalStoreEntry>;
}

/** 本地附件仓根目录（每个实例独立：NX_KV_ATTACHMENTS 覆盖根时测试天然隔离）。 */
export function localDir(): string {
  return join(attachmentsRootFromEnv(), LOCAL_STORE_DIRNAME);
}

const nowIso = (): string => new Date().toISOString();

/**
 * 新条目的 id：32 位 hex（16 字节随机）。与云端 fileId 同构——
 * looksLikeFileId 照常认，正文语法零分叉。
 */
function newFileId(): string {
  return randomBytes(16).toString('hex');
}

// 同目录不重名的落点（`名字 (2).ext`）——资源行是唯一真相，文件名只是给人看的。
function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const { name: stem, ext } = parsePath(name);
  let n = 1;
  let candidate = name;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

function localRows(db: DbApi): Row[] {
  return db.all(
    `SELECT id, name, local_path, mime, size, meta
       FROM attachments
      WHERE kind = 'file' AND storage = 'local' AND deleted_at IS NULL`
  );
}

function resolvedPath(row: { local_path?: any; name?: any }, dir: string): string {
  const stored = String(row.local_path || '');
  if (stored && existsSync(stored)) return stored;
  const name = String(row.name || '');
  if (!name) return '';
  const fallback = join(dir, name);
  return existsSync(fallback) ? fallback : '';
}

/**
 * 上传一个附件到本地仓：落盘 + 写 attachments 行，返回元数据。
 * 不碰网络——本机 serve 进程内一次落盘即完成。
 *
 * @param {{name: string, buffer: Buffer, contentType?: string}} p
 * @returns {Promise<{fileId: string, name: string, size: number, contentType: string, path: string, storage: 'local'}>}
 */
export async function localUpload(
  { name, buffer, contentType = '' }: { name?: string; buffer?: Buffer; contentType?: string } = {}
): Promise<LocalUploadResult> {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('上传内容为空');
  const base = safeFileName(name);
  if (!base || base === 'file') throw new Error('上传需要文件名');
  const dir = localDir();
  const db = getDb();
  const taken = new Set(localRows(db).map((r) => String(r.name || '')));
  const id = newFileId();
  const fileName = uniqueName(taken, localNameFor(id, base, contentType || contentTypeOf(base)));
  const abs = join(dir, fileName);
  await fsp.mkdir(dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  const ct = contentType || contentTypeOf(fileName);
  try {
    upsertFileAttachment(db, {
      id,
      name: fileName,
      localPath: abs,
      mime: ct,
      size: buffer.length,
      storage: 'local',
      meta: { contentType: ct, createdAt: nowIso() },
    });
  } catch (err) {
    // DB 写失败 → 字节不留在盘上（否则下次扫描会出现无记录的孤儿文件）
    try {
      await fsp.unlink(abs);
    } catch {
      /* 删不掉就留下，至少不是「有记录无文件」 */
    }
    throw err;
  }
  return { fileId: id, name: fileName, size: buffer.length, contentType: ct, path: abs, storage: 'local' };
}

/** attachments 行 + 落盘文件都在 → 返回本地元数据；没传过或文件被手删 → null。 */
export async function localResolve(fileId: unknown): Promise<LocalStoreEntry | null> {
  const id = String(fileId ?? '').trim();
  if (!id) return null;
  const db = getDb();
  const row = getAttachment(db, id);
  if (!row || row.deletedAt || row.kind !== 'file' || row.storage !== 'local') return null;
  const dir = localDir();
  const abs = resolvedPath({ local_path: row.localPath, name: row.name }, dir);
  if (!abs) return null;
  return {
    fileId: id,
    path: abs,
    name: String(row.name || ''),
    size: Number(row.size) || 0,
    contentType: String(row.mime || ''),
    storage: 'local',
  };
}

/** 本地仓全部在盘条目（id → 元数据），供领取侧批量标注。 */
export async function localIndex(): Promise<LocalStoreIndex> {
  const dir = localDir();
  const index = new Map<string, LocalStoreEntry>();
  for (const row of localRows(getDb())) {
    const abs = resolvedPath(row, dir);
    if (!abs) continue;
    index.set(row.id, {
      fileId: row.id,
      path: abs,
      name: String(row.name || ''),
      size: Number(row.size) || 0,
      contentType: String(row.mime || ''),
      storage: 'local',
    });
  }
  return { dir, index };
}

/** 本地文件读流（HTTP 透传给面板 <img> 用）；调用方先 localResolve 确认在盘。 */
export function localReadStream(absPath: string): ReadStream {
  return createReadStream(absPath);
}
