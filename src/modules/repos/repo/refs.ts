// refs / ref_bindings 的窄仓储：文档索引层（T05 起才有写入方）。
//
// refs 是**全新**的索引层，磁盘上从来没有过 refs.json。行 = 「有身份、
// 内容在库外的东西」：locator 是稳定标识（docs 树相对路径 / 外部绝对路径）。
// ref_bindings 一行 = 某个宿主列表里的一项（type: repo / group / group_repo）。
//
// 与 ext 里 DocRef（r.doc / b.docLinks…）的分工：ext 是「宿主身上挂了哪些
// 覆盖」（JSON 形态契约，docs 域直接消费）；这张表是「索引与孤儿清单」——
// 未被任何宿主绑定的 .md 在这里 state='orphan'，面板能列出它们。
// 绑定命令（repo bind-topics）落库前先跑 rebuildRefIndex 把索引补齐。
import { db } from './open.js';
import { refIdOf } from '../../../core/db/import-json.js';
import type { DbApi, Row } from '../../../core/db/driver.js';

/** 稳定 ref id：locator 的纯函数（同一份文档换台机器也是同一个 id）。 */
export { refIdOf };

/** putBinding / removeBinding / listBindingsOfHost 的公共输入形状。 */
interface BindingInput {
  repoKey?: unknown;
  groupKey?: string | null;
  refId?: unknown;
  type?: unknown;
  position?: number;
  note?: string;
  atMs: number;
}

// ─── refs ─────────────────────────────────────────────────────────────

/** upsert 一个 ref（幂等：同 id 不覆盖已有 state）。 */
export function upsertRef(
  conn: DbApi,
  { id, type, locator, state = '', atMs }: { id?: unknown; type?: unknown; locator?: unknown; state?: unknown; atMs: number }
): void {
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, :type, :locator, :state, 0, NULL, :at, :at)
     ON CONFLICT(id) DO NOTHING`,
    { id: String(id || refIdOf(locator)), type: String(type || 'md'), locator: String(locator || ''), state: String(state || ''), at: atMs }
  );
}

/** 快搜：前缀范围比较（>= q AND < q||上界）走 ix_refs_locator，不用 LIKE（SCAN）。
 *  索引是 `locator COLLATE NOCASE`，查询侧必须显式带上同一个 collation，
 *  否则比较规则不匹配，SQLite 只能全表扫。 */
export function scanRefs(conn: DbApi, { prefix, limit = 50 }: { prefix?: unknown; limit?: number } = {}): Row[] {
  const q = String(prefix || '');
  if (!q) return conn.all('SELECT * FROM refs WHERE deleted_at IS NULL ORDER BY locator LIMIT :n', { n: Number(limit) });
  // 上界 = 前缀末字符 +1（逐字节进位；locator 是普通文本，够用）
  const end = q.slice(0, -1) + String.fromCharCode(q.charCodeAt(q.length - 1) + 1);
  return conn.all(
    `SELECT * FROM refs
      WHERE locator COLLATE NOCASE >= :q AND locator COLLATE NOCASE < :end AND deleted_at IS NULL
      ORDER BY locator LIMIT :n`,
    { q, end, n: Number(limit) }
  );
}

/** 孤儿列表：未被任何**未软删**宿主绑定的 ref（面板「孤儿文档」）。 */
export function listOrphans(conn: DbApi = db()): Row[] {
  return conn.all(
    `SELECT r.* FROM refs r
     WHERE r.state = 'orphan' AND r.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ref_bindings b JOIN repos h ON h.key = b.repo_key
          WHERE b.ref_id = r.id AND h.deleted_at IS NULL
       )
     ORDER BY r.locator`
  );
}

// ─── ref_bindings ─────────────────────────────────────────────────────

/**
 * 绑一条：宿主（repo_key 必填，group_key 仅 group_repo）+ ref + 位置 + 说明。
 * 重复绑定幂等（INSERT OR IGNORE —— ux_ref_bindings 的冲突目标带 COALESCE
 * 表达式，SQLite 的 ON CONFLICT 语法写不出等价形式，这里用 OR IGNORE）。
 */
export function putBinding(
  conn: DbApi,
  { repoKey, groupKey = null, refId, type, position = 0, note = '', atMs }: BindingInput
): void {
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

/** 摘一条绑定（幂等）。 */
export function removeBinding(conn: DbApi, { repoKey, groupKey = null, refId }: { repoKey?: unknown; groupKey?: string | null; refId?: unknown }): void {
  conn.run(
    `DELETE FROM ref_bindings WHERE repo_key = :repo AND COALESCE(group_key,'') = COALESCE(:group,'') AND ref_id = :ref`,
    { repo: String(repoKey || ''), group: groupKey == null ? null : String(groupKey), ref: String(refId || '') }
  );
}

/** 一个宿主的绑定（有序；宿主 = repo_key（+ group_key 的 group_repo 列表））。 */
export function listBindingsOfHost(conn: DbApi, { repoKey, groupKey = null }: { repoKey?: unknown; groupKey?: string | null } = {}): Row[] {
  return conn.all(
    `SELECT b.*, r.locator, r.type AS ref_type, r.state AS ref_state
     FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
     WHERE b.repo_key = :repo AND COALESCE(b.group_key,'') = COALESCE(:group,'')
     ORDER BY b.position, b.rowid`,
    { repo: String(repoKey || ''), group: groupKey == null ? null : String(groupKey) }
  );
}

// ─── ref_bindings ─────────────────────────────────────────────────────
