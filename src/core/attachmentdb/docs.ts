// 文档索引：refs 行的解析/建/删，与任务、文档两块正文的整库重扫（迁移与索引用；幂等）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { refIdFor } from './ids.js';
import { syncRefAttachments, syncTaskAttachments } from './relations.js';

/**
 * 把一个「文档标识」解析成 refs.id：先按 id，再按 locator（原样 / 反斜杠归一），
 * 都没有返回 null。CLI `--ref` 与面板选择器共用这一条，避免各自猜地址语法。
 *
 * **docId 前缀也认**（#165 二轮：面板选择器给的是 `rel:` / `path:` 形式，
 * 而 refs.locator 存的是裸相对路径 / 绝对路径——不剥前缀就永远匹配不上，
 * 面板「给任务挂文档」直接失败）。故额外按「剥前缀后的 locator」再查一次。
 */
export function resolveRefId(conn: any, input?: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const byId = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: raw });
  if (byId) return byId.id;
  const loc = raw.replace(/\\/g, '/');
  const byLoc = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc }
  );
  if (byLoc) return byLoc.id;
  // docId 形态（rel:xxx / path:xxx）→ 剥前缀按 locator 再查
  const stripped = /^rel:|^path:/i.test(loc) ? loc.replace(/^rel:|^path:/i, '') : '';
  if (stripped) {
    const byStripped = conn.get(
      'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc: stripped }
    );
    if (byStripped) return byStripped.id;
  }
  const derived = refIdFor(loc);
  const byDerived = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: derived });
  return byDerived ? byDerived.id : null;
}

export interface EnsureDocRefInput {
  locator?: string;
  atMs?: number;
}

/** 确保 refs 行存在（文档保存 / 索引重建共用；已有行不重置 state）。 */
export function ensureDocRef(conn: any, { locator, atMs = Date.now() }: EnsureDocRefInput = {}): string | null {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return null;
  const id = refIdFor(loc);
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET type = 'md', locator = excluded.locator, updated_at = excluded.updated_at`,
    { id, locator: loc, at: atMs }
  );
  return id;
}

/** 文档删除：refs 行消失，ref_attach / ref_bindings 随之 CASCADE。 */
export function forgetDocRef(conn: any, locator?: string): number {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return 0;
  const r = conn.run('DELETE FROM refs WHERE id = :id', { id: refIdFor(loc) });
  return Number(r.changes) || 0;
}

// ─── 宿主绑定（ref_bindings）──────────────────────────────────────────
//
// ref_bindings 一行 = 「某个宿主（仓库 / 组 / 组内某仓库）的文档列表里的一项」。
// 表在 v3 迁移时建好，但长期只有 bind-topics 与导入器在写——docs 域改 ext
// （r.doc / docLinks / b.repoDocs）时不同步，于是库里全是 orphan、面板上却
// 显示「已绑定」（#183 实锤：4 篇已挂文档，ref_bindings 零行）。这四个
// 原语给 docs 域的整表重建用，写入方只允许 docs/ref-sync。

export interface RefBindingRow {
  repoKey?: string;
  groupKey?: string | null;
  refId?: string;
  type?: string;
  position?: number;
  note?: string;
  atMs?: number;
}

/** 绑一条（幂等：唯一键冲突时保留原行）。 */
export function putRefBinding(conn: any, { repoKey, groupKey = null, refId, type = 'repo', position = 0, note = '', atMs = Date.now() }: RefBindingRow = {}): void {
  conn.run(
    `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
     VALUES (:repo, :group, :ref, :type, :pos, :note, :at)`,
    {
      repo: String(repoKey || ''),
      group: groupKey == null ? null : String(groupKey),
      ref: String(refId || ''),
      type: String(type || 'repo'),
      pos: Number(position) || 0,
      note: String(note || ''),
      at: atMs,
    }
  );
}

/** 清空全部绑定（整表重建的第一步；只在重建事务内用）。 */
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

/** 全量重扫 docs 自有树 + 外部 .md（迁移与索引重建用；幂等）。 */
export function syncDocAttachmentIndex(conn: any, { docsRoot, atMs = Date.now() }: {
  docsRoot?: string; atMs?: number;
} = {}): number {
  const root = String(docsRoot || '');
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
    n += syncRefAttachments(conn, { refId, text, atMs });
  }
  // 外部 .md（refs.locator 是绝对路径）：不在 docs 树里，但同样是文档库的一行。
  // 迁移必须把它们的正文引用也落库，否则「存量文档的图片」只有正文 fileId 字符串。
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
