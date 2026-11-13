// 文档索引：refs 行的解析/建/删，与任务、文档两块正文的整库重扫（迁移与索引用；幂等）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { refIdFor } from './ids.js';
import { syncRefAttachments, syncTaskAttachments } from './relations.js';

/**
 * 文档标识 → refs.id：只认 `refs.id`（`ref:<id>` 是面板 docId 的前缀写法）。
 * locator 是外部文件的物理位置，不是身份——不做任何按路径回退。
 */
export function resolveRefId(conn: any, input?: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const id = raw.replace(/^ref:/i, '');
  const row = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id });
  return row ? String(row.id) : null;
}

export interface EnsureDocRefInput {
  /** 已有 ref 的 id；给了且不存在时按它建行（导入用） */
  ref?: string;
  /** 外部绝对路径 / URL / 历史 locator */
  locator?: string;
  atMs?: number;
}

const sha1 = (s: unknown): string => createHash('sha1').update(String(s), 'utf8').digest('hex');

const isExternal = (input: string): boolean =>
  /^https?:\/\//i.test(input) || isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input) || input.startsWith('//');

/**
 * 确保 refs 行存在（文档保存 / 外部绑定 / 导入共用；已有行不重置 state）。
 * 有 locator 时先按 locator 命中；新建行的 id 由 locator 派生（外部）或随机（直接 ref）。
 *
 * 迁移链兼容：v2 的 apply 会调用本函数，那时 refs 还没有 origin 列（v6 才加），
 * 所以 INSERT 的列清单按 pragma_table_info 现取——这不是运行时兼容，是迁移步骤
 * 执行顺序的硬约束。
 */
export function ensureDocRef(conn: any, { ref, locator, atMs = Date.now() }: EnsureDocRefInput = {}): string | null {
  const refId = String(ref || '').trim();
  if (refId) {
    const byId = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: refId });
    if (byId) return String(byId.id);
  }
  const input = String(locator ?? '').trim().replace(/\\/g, '/');
  if (!input && !refId) return null;
  if (input) {
    const byLoc = conn.get(
      'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL ORDER BY id LIMIT 1',
      { loc: input }
    );
    if (byLoc) return String(byLoc.id);
  }
  const external = input ? isExternal(input) : false;
  let id = refId || (external ? refIdFor(input) : 'ref_' + sha1(randomUUID()).slice(0, 16));
  if (conn.get('SELECT 1 AS x FROM refs WHERE id = :id', { id })) {
    // id 被占用：直接 ref 换一个；locator 场景理论上不会撞（已按 locator 查过）
    if (refId) return id;
    id = 'ref_' + sha1(randomUUID()).slice(0, 16);
  }
  const hasOrigin = !!conn.get("SELECT name FROM pragma_table_info('refs') WHERE name = 'origin'");
  if (hasOrigin) {
    conn.run(
      `INSERT INTO refs (id, type, locator, origin, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :locator, :origin, 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      { id, locator: input, origin: external ? 'external' : 'own', at: atMs }
    );
  } else {
    conn.run(
      `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      { id, locator: input, at: atMs }
    );
  }
  return id;
}

/** 文档删除：refs 行消失，ref_bodies / ref_attach / ref_bindings 随之 CASCADE。 */
export function forgetDocRef(conn: any, input?: string): number {
  const id = resolveRefId(conn, input);
  if (!id) return 0;
  const r = conn.run('DELETE FROM refs WHERE id = :id', { id });
  return Number(r.changes) || 0;
}

// ─── 宿主绑定（ref_bindings）──────────────────────────────────────────
//
// ref_bindings 一行 = 「某个宿主（仓库 / 组 / 组内某仓库）的文档列表里的一项」。
// v8 起宿主 ext（doc/docLinks/repoDocs）是语义，ref_bindings 是索引：
// 写入统一走 docs/ref-sync 的整表重建，业务读路径只读这张表。

export interface RefBindingRow {
  repoKey?: string;
  groupKey?: string | null;
  refId?: string;
  type?: string;
  position?: number;
  note?: string;
  tag?: string;
  atMs?: number;
}

/** 绑一条（幂等：唯一键冲突时保留原行）。 */
export function putRefBinding(conn: any, {
  repoKey,
  groupKey = null,
  refId,
  type = 'repo',
  position = 0,
  note = '',
  tag = '',
  atMs = Date.now(),
}: RefBindingRow = {}): void {
  conn.run(
    `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, tag, created_at)
     VALUES (:repo, :group, :ref, :type, :pos, :note, :tag, :at)`,
    {
      repo: String(repoKey || ''),
      group: groupKey == null ? null : String(groupKey),
      ref: String(refId || ''),
      type: String(type || 'repo'),
      pos: Number(position) || 0,
      note: String(note || ''),
      tag: String(tag || ''),
      at: atMs,
    }
  );
}

/** 清空绑定索引（整表重建前调用；入参是语义权威时，索引全部可再生）。 */
export function clearRefBindings(conn: any): void {
  conn.run('DELETE FROM ref_bindings');
}

/** 绑定命中的 ref → state 清空（不再是孤儿）。 */
export function markRefBound(conn: any, refId?: string): void {
  const id = String(refId || '');
  if (!id) return;
  conn.run("UPDATE refs SET state = '', updated_at = :at WHERE id = :id", { id, at: Date.now() });
}

/** 没有任何绑定的 ref → 回到 orphan（重建收尾，防止摘绑定后状态残留）。 */
export function markUnboundRefsOrphan(conn: any): number {
  const r = conn.run(
    `UPDATE refs SET state = 'orphan', updated_at = :at
      WHERE deleted_at IS NULL AND state <> 'orphan'
        AND id NOT IN (SELECT ref_id FROM ref_bindings)`,
    { at: Date.now() }
  );
  return Number(r.changes) || 0;
}

/** 全量重扫任务正文（迁移与导入后用；幂等）。 */
export function syncTaskAttachmentIndex(conn: any, { atMs = Date.now() }: { atMs?: number } = {}): number {
  const rows = conn.all('SELECT id, body FROM tasks ORDER BY id');
  let n = 0;
  for (const row of rows) n += syncTaskAttachments(conn, { taskId: row.id, text: row.body, atMs });
  return n;
}

/**
 * 全量重扫 docs 自有树 + 外部 .md（**仅迁移 / 索引重建用**；幂等）。
 *
 * 这是 attachment 层的例外读盘：v2 迁移时正文还没进库，必须从旧文档目录取一次。
 * 业务读路径不得调用它——自有文档正文的唯一真相是 `ref_bodies`。
 */
export function syncDocAttachmentIndex(conn: any, { docsDir, atMs = Date.now() }: {
  docsDir?: string; atMs?: number;
} = {}): number {
  const root = String(docsDir || '');
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && /\.md$/i.test(e.name)) files.push(abs);
    }
  };
  if (root && existsSync(root)) walk(root);
  let n = 0;
  const covered = new Set<string>();
  for (const abs of files.sort()) {
    const locator = relative(root, abs).replace(/\\/g, '/');
    covered.add(resolve(abs).replace(/\\/g, '/').toLowerCase());
    let text = '';
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const refId = ensureDocRef(conn, { locator, atMs });
    if (!refId) continue;
    n += syncRefAttachments(conn, { refId, text, atMs });
  }
  // 外部 .md（refs.locator 是绝对路径）：不在 docs 目录里，但同样是文档库的一行。
  for (const row of conn.all("SELECT id, locator FROM refs WHERE type = 'md'")) {
    const loc = String(row.locator || '');
    if (!isAbsolute(loc) || !existsSync(loc)) continue;
    if (covered.has(resolve(loc).replace(/\\/g, '/').toLowerCase())) continue;
    if (!/\.md$/i.test(loc)) continue;
    let text = '';
    try {
      text = readFileSync(loc, 'utf8');
    } catch {
      continue;
    }
    n += syncRefAttachments(conn, { refId: row.id, text, atMs });
  }
  return n;
}
