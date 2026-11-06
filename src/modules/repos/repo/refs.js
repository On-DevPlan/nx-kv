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
import { SENTINEL_REPO_KEY } from './rows.js';

/** 稳定 ref id：locator 的纯函数（同一份文档换台机器也是同一个 id）。 */
export { refIdOf };

// ─── refs ─────────────────────────────────────────────────────────────

/** upsert 一个 ref（幂等：同 id 不覆盖已有 state）。 */
export function upsertRef(conn, { id, type, locator, state = '', atMs }) {
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, :type, :locator, :state, 0, NULL, :at, :at)
     ON CONFLICT(id) DO NOTHING`,
    { id: String(id || refIdOf(locator)), type: String(type || 'md'), locator: String(locator || ''), state: String(state || ''), at: atMs }
  );
}

/** 快搜：前缀范围比较（>= q AND < q||上界）走 ix_refs_locator，不用 LIKE（SCAN）。 */
export function scanRefs(conn, { prefix, limit = 50 } = {}) {
  const q = String(prefix || '');
  if (!q) return conn.all('SELECT * FROM refs WHERE deleted_at IS NULL ORDER BY locator LIMIT :n', { n: Number(limit) });
  // 上界 = 前缀末字符 +1（逐字节进位；locator 是普通文本，够用）
  const end = q.slice(0, -1) + String.fromCharCode(q.charCodeAt(q.length - 1) + 1);
  return conn.all(
    'SELECT * FROM refs WHERE locator >= :q AND locator < :end AND deleted_at IS NULL ORDER BY locator LIMIT :n',
    { q, end, n: Number(limit) }
  );
}

/** 孤儿列表：未被任何宿主绑定的 ref（面板「孤儿文档」）。 */
export function listOrphans(conn = db()) {
  return conn.all(
    `SELECT r.* FROM refs r
     WHERE r.state = 'orphan' AND r.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM ref_bindings b WHERE b.ref_id = r.id)
     ORDER BY r.locator`
  );
}

// ─── ref_bindings ─────────────────────────────────────────────────────

/**
 * 绑一条：宿主（repo_key 必填，group_key 仅 group_repo）+ ref + 位置 + 说明。
 * 重复绑定幂等（INSERT OR IGNORE —— ux_ref_bindings 的冲突目标带 COALESCE
 * 表达式，SQLite 的 ON CONFLICT 语法写不出等价形式，这里用 OR IGNORE）。
 */
export function putBinding(conn, { repoKey, groupKey = null, refId, type, position = 0, note = '', atMs }) {
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
export function removeBinding(conn, { repoKey, groupKey = null, refId }) {
  conn.run(
    `DELETE FROM ref_bindings WHERE repo_key = :repo AND COALESCE(group_key,'') = COALESCE(:group,'') AND ref_id = :ref`,
    { repo: String(repoKey || ''), group: groupKey == null ? null : String(groupKey), ref: String(refId || '') }
  );
}

/** 一个宿主的绑定（有序；宿主 = repo_key（+ group_key 的 group_repo 列表））。 */
export function listBindingsOfHost(conn, { repoKey, groupKey = null } = {}) {
  return conn.all(
    `SELECT b.*, r.locator, r.type AS ref_type, r.state AS ref_state
     FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
     WHERE b.repo_key = :repo AND COALESCE(b.group_key,'') = COALESCE(:group,'')
     ORDER BY b.position, b.rowid`,
    { repo: String(repoKey || ''), group: groupKey == null ? null : String(groupKey) }
  );
}

// ─── 索引重建（绑定命令的「先建 refs」一步）────────────────────────────

/**
 * 把 docs 树与约定路径补进索引（幂等；在**外层事务内**跑 —— docsFiles 由
 * 调用方在事务外扫好，同步 fs 不进事务体）。
 *
 *   1. docs 树每个 .md → refs 一行（默认 state='orphan'）；
 *   2. 每个登记仓库 → 约定主篇（`repo/<key>/index.md`，旧单文件回落 `repo/<key>.md`）；
 *   3. 每个组 → `board/<seg>/index.md`（回落 `board/<seg>.md`）；
 *      组内每个成员 → `group/<seg>/<repoKey>/index.md`（回落 `.md`）。
 *   4. 命中约定路径的 ref：state 清空 + 绑定落表。
 *
 * 与 import-json.importRefs 同一口径（docs 模块读文档时的回落顺序）。
 * @returns {{refs: number, bindings: number}}
 */
export function rebuildRefIndex(conn, { docsFiles = [], atMs }) {
  let refCount = 0;
  let bindCount = 0;
  const fileSet = new Set(docsFiles.map(String));

  for (const locator of fileSet) {
    const before = conn.get('SELECT id FROM refs WHERE id = :id', { id: refIdOf(locator) });
    if (!before) refCount += 1;
    upsertRef(conn, { id: refIdOf(locator), type: 'md', locator, state: 'orphan', atMs });
  }

  const bind = (repoKey, groupKey, locator, type, position = 0, note = '') => {
    if (!fileSet.has(locator)) return false;
    const id = refIdOf(locator);
    conn.run("UPDATE refs SET state = '' WHERE id = :id", { id });
    putBinding(conn, { repoKey, groupKey, refId: id, type, position, note, atMs });
    bindCount += 1;
    return true;
  };

  const repos = conn.all("SELECT key FROM repos WHERE type <> 'group' AND deleted_at IS NULL AND key <> :s", {
    s: SENTINEL_REPO_KEY,
  });
  for (const r of repos) {
    const key = String(r.key);
    if (bind(key, null, `repo/${key}/index.md`, 'repo')) continue;
    bind(key, null, `repo/${key}.md`, 'repo');
  }

  const groups = conn.all("SELECT key, name FROM repos WHERE type = 'group' AND deleted_at IS NULL");
  const segOf = (groupKey) => String(groupKey || '').slice('group/'.length);
  for (const g of groups) {
    const gk = String(g.key);
    const seg = segOf(gk);
    if (bind(gk, null, `board/${seg}/index.md`, 'group')) continue;
    bind(gk, null, `board/${seg}.md`, 'group');
    for (const m of conn.all('SELECT repo_key FROM repo_group_members WHERE group_key = :g ORDER BY position, rowid', { g: gk })) {
      const rk = String(m.repo_key);
      if (bind(rk, gk, `group/${seg}/${rk}/index.md`, 'group_repo')) continue;
      bind(rk, gk, `group/${seg}/${rk}.md`, 'group_repo');
    }
  }

  return { refs: refCount, bindings: bindCount };
}
