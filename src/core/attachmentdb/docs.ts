// 文档索引：refs 行的解析/建/删，与任务、文档两块正文的整库重扫（迁移与索引用；幂等）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { refIdFor } from './ids.js';
import { refIdByRel } from './bodies.js';
import { syncRefAttachments, syncTaskAttachments } from './relations.js';

/**
 * 把一个「文档标识」解析成 refs.id：先按 id，再按 rel（v6 起的逻辑名），
 * 再按 locator（历史入口 / 外部绝对路径），都没有返回 null。
 * CLI `--ref` 与面板选择器共用这一条，避免各自猜地址语法。
 *
 * **docId 前缀也认**（#165 二轮：面板选择器给的是 `rel:` / `path:` 形式）。
 */
export function resolveRefId(conn: any, input?: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const byId = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: raw });
  if (byId) return byId.id;

  const loc = raw.replace(/\\/g, '/');
  const stripped = /^rel:|^path:/i.test(loc) ? loc.replace(/^rel:|^path:/i, '') : '';
  const candidates = [loc, stripped].filter(Boolean);

  // v6 之前（迁移链早期步骤）refs 还没有 rel 列，只能走历史 locator 入口
  if (hasRelColumn(conn)) {
    for (const cand of candidates) {
      const id = refIdByRel(conn, cand);
      if (id) return id;
    }
  }
  // 历史入口：locator（v4 及以前的行；外部绝对路径仍靠它命中）
  for (const cand of candidates) {
    const byLoc = conn.get(
      'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc: cand }
    );
    if (byLoc) return byLoc.id;
  }
  const derived = refIdFor(loc);
  const byDerived = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: derived });
  return byDerived ? byDerived.id : null;
}

export interface EnsureDocRefInput {
  /** v6 起的逻辑名（首选） */
  rel?: string;
  /** 历史入口 / 外部绝对路径（兼容既有调用方） */
  locator?: string;
  atMs?: number;
}

const sha1 = (s: unknown): string => createHash('sha1').update(String(s), 'utf8').digest('hex');

/**
 * refs 是否已有 v6 的 rel 列。
 * 迁移链会从旧结构逐级升级：v2-data 也会调 ensureDocRef，那时 rel 还不存在，
 * 不能无条件查询它（否则 1→2 直接失败）。列存在性用 pragma_table_info 判断。
 */
function hasRelColumn(conn: any): boolean {
  return !!conn.get("SELECT name FROM pragma_table_info('refs') WHERE name = 'rel'");
}

/** 外部绝对路径 / URL 的逻辑 rel（v6 迁移同一口径）。 */
function externalRelOf(input: string): string {
  let seed = isAbsolute(input) ? resolve(input).replace(/\\/g, '/') : input;
  if (/^[A-Z]:/.test(seed)) seed = seed.charAt(0).toLowerCase() + seed.slice(1);
  return 'external/' + sha1(seed).slice(0, 16);
}

/**
 * 确保 refs 行存在（文档保存 / 索引重建共用；已有行不重置 state）。
 * 先按 rel / locator 命中既有行——v6 迁移保留的 id 绝不被新公式改写。
 */
export function ensureDocRef(conn: any, { rel, locator, atMs = Date.now() }: EnsureDocRefInput = {}): string | null {
  const input = String(rel ?? locator ?? '').trim().replace(/\\/g, '/');
  if (!input) return null;
  const hasRel = hasRelColumn(conn);
  if (hasRel) {
    const byRel = refIdByRel(conn, input);
    if (byRel) return byRel;
  }
  // 绝对路径 / URL：先按 locator 命中（外部镜像行的 id 与 rel 都不是新公式）
  const byLoc = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc: input }
  );
  if (byLoc) return String(byLoc.id);

  // v6 之前：保持历史形态（不动 locator 之外的语义）
  if (!hasRel) {
    const oldId = refIdFor(input);
    conn.run(
      `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO UPDATE SET type = 'md', locator = excluded.locator, updated_at = excluded.updated_at`,
      { id: oldId, locator: input, at: atMs }
    );
    return oldId;
  }

  const external = /^https?:\/\//i.test(input)
    || isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input) || input.startsWith('//');
  const targetRel = external ? externalRelOf(input) : input;
  const id = refIdFor(external ? input : targetRel);
  conn.run(
    `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :rel, :locator, :origin, 'orphan', 0, NULL, :at, :at)
     ON CONFLICT(id) DO NOTHING`,
    { id, rel: targetRel, locator: input, origin: external ? 'external' : 'own', at: atMs }
  );
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

/**
 * 清空「派生绑定」（v7）：只清 rel ≠ id 的 ref 的绑定。
 *
 * rel = id 的行是 v7 新建的直接 ref（ref 是 DB 实体，没有路径）：
 * 它的归属由用户直接写入 ref_bindings，不来自 ext，整表重建时不能抹掉。
 */
export function clearRefBindings(conn: any): void {
  conn.run('DELETE FROM ref_bindings WHERE ref_id NOT IN (SELECT id FROM refs WHERE rel = id)');
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
    n += syncRefAttachments(conn, { refId, text, atMs });
  }
  // 外部 .md（refs.locator 是绝对路径）：不在 docs 目录里，但同样是文档库的一行。
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
