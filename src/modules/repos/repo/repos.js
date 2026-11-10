// 仓库 / 组 / 成员的窄仓储：一次调用 = 一条（或一小簇）语句。
//
// 与 localtask/repo 同一纪律：
//   - 返回纯对象（driver 出站已 {...row}）；不存在返回 null / 空数组（不抛）；
//   - 写路径经 txw（或由调用方包在外层事务里 —— 嵌套自动 SAVEPOINT）；
//   - SQL 只出现在 repo 层，service 层不写 SQL 字符串。
//
// topics 的绑定也在这里（`topics.repo_key` 的外键指向 repos.key，绑定的
// 前置校验属于 repos 域）：bindTopicToRepo 是 T05 才接通的写入口。
import { db, txw } from './open.js';
import { SENTINEL_REPO_KEY } from './rows.js';

// ─── 行读取 ───────────────────────────────────────────────────────────

/** 全部登记行（type='repo'；哨兵默认隐藏 —— 它不是用户登记的仓库）。 */
export function listRepoRows(conn = db(), { includeSentinel = false } = {}) {
  const rows = conn.all("SELECT * FROM repos WHERE type <> 'group' AND deleted_at IS NULL ORDER BY sort_order, created_at, key");
  return includeSentinel ? rows : rows.filter((r) => r.key !== SENTINEL_REPO_KEY);
}

/** 全部组行（type='group'）。 */
export function listGroupRows(conn = db()) {
  return conn.all("SELECT * FROM repos WHERE type = 'group' AND deleted_at IS NULL ORDER BY sort_order, created_at, key");
}

/** 按 key 取登记行 / 组行（不区分类型）。不存在返回 null。 */
export function getRowByKey(key, conn = db()) {
  return conn.get('SELECT * FROM repos WHERE key = :key AND deleted_at IS NULL', { key: String(key || '') }) || null;
}

/** 全部成员行（跨组；组装配/投影用）。 */
export function listAllMembers(conn = db()) {
  return conn.all('SELECT group_key, repo_key, position, note FROM repo_group_members ORDER BY group_key, position, rowid');
}

// ─── 组级参考仓库绑定（v4）────────────────────────────────────────────

/** 全部组级参考绑定（跨组；store 装配用）。 */
export function listAllGroupRefs(conn = db()) {
  return conn.all('SELECT group_key, ref_key, note, position FROM group_refs ORDER BY group_key, position, rowid');
}

/** 一个组的参考绑定（有序）。 */
export function listGroupRefs(groupKey, conn = db()) {
  return conn.all(
    'SELECT ref_key, note, position FROM group_refs WHERE group_key = :g ORDER BY position, rowid',
    { g: String(groupKey || '') }
  );
}

/** 整组重建参考绑定（组内共享；ref/组不存在由外键拒绝）。 */
export function replaceGroupRefs(conn, groupKey, refs, atMs) {
  conn.run('DELETE FROM group_refs WHERE group_key = :g', { g: String(groupKey || '') });
  const seen = new Set();
  refs.forEach((ref, position) => {
    const key = String(ref && ref.id ? ref.id : '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    conn.run(
      `INSERT OR IGNORE INTO group_refs (group_key, ref_key, note, position, created_at)
       VALUES (:g, :r, :n, :p, :at)`,
      { g: String(groupKey || ''), r: key, n: String((ref && ref.note) || ''), p: position, at: atMs }
    );
  });
}

/** 清掉一个组的全部参考绑定（删组时用）。 */
export function clearGroupRefs(conn, groupKey) {
  conn.run('DELETE FROM group_refs WHERE group_key = :g', { g: String(groupKey || '') });
}

/** 一个组的成员行（有序）。 */
export function listMembers(groupKey, conn = db()) {
  return conn.all(
    'SELECT group_key, repo_key, position, note FROM repo_group_members WHERE group_key = :g ORDER BY position, rowid',
    { g: String(groupKey || '') }
  );
}

/** 这个仓库被哪些组包含（反查，走 ix_members_repo）。 */
export function listGroupsOfRepo(repoKey, conn = db()) {
  return conn.all('SELECT group_key, position, note FROM repo_group_members WHERE repo_key = :r ORDER BY group_key, position', {
    r: String(repoKey || ''),
  });
}

// ─── 行写入 ───────────────────────────────────────────────────────────

/** 取该类型下一个可用的 sort_order（插到末尾；存量顺序稳定）。 */
function nextSortOrder(conn, type) {
  const row = conn.get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM repos WHERE type = :t', { t: type });
  return Number((row && row.m) || -1) + 1;
}

/**
 * upsert 一行（repo 或 group 由 row.type 决定）。
 * 冲突时只更新内容列：sort_order 与 created_at 保持首次落库值
 * （登记顺序与创建时间是「来历」，不随后续写漂移）。
 * 软删过的同 key 行在这里**恢复**（同一个 key 就是同一个仓库身份）。
 */
export function upsertRow(conn, row) {
  const sort = Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : nextSortOrder(conn, row.type);
  conn.run(
    `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:key, :type, :name, :desc, :path, :remote, :sort, :ext, '', 0, NULL, :created, :updated)
     ON CONFLICT(key) DO UPDATE SET
       type = excluded.type, name = excluded.name, description = excluded.description,
       path = excluded.path, remote = excluded.remote, ext = excluded.ext,
       deleted_at = NULL, updated_at = excluded.updated_at`,
    {
      key: row.key,
      type: row.type,
      name: row.name,
      desc: row.description,
      path: row.path,
      remote: row.remote,
      sort,
      ext: row.ext,
      created: row.createdAtMs,
      updated: row.updatedAtMs,
    }
  );
}

/**
 * 改一行的主键（改 key / 组冻结 key 的例外迁移）。成员边、ref 绑定、
 * topics.repo_key / topics.group_key 全部 ON UPDATE CASCADE 跟随。
 * 目标 key 已存在 → UNIQUE 失败（调用方先查重）。
 */
export function renameRow(conn, fromKey, toKey, atMs) {
  conn.run('UPDATE repos SET key = :to, updated_at = :at WHERE key = :from', {
    from: String(fromKey || ''),
    to: String(toKey || ''),
    at: atMs,
  });
}

/** 真删一行（硬删；成员边 / ref 绑定级联清）。返回是否存在。 */
export function deleteRow(conn, key) {
  const r = conn.run('DELETE FROM repos WHERE key = :key', { key: String(key || '') });
  return Number(r.changes) > 0;
}

/**
 * 软删一行：行还在（key 身份、成员边、文档绑定全部保留），只是不出现在读路径里。
 * 再登记同 key 时由 upsertRow 的 `deleted_at = NULL` 恢复。
 */
export function softDeleteRow(conn, key, atMs) {
  const r = conn.run(
    'UPDATE repos SET deleted_at = :at, updated_at = :at WHERE key = :key AND deleted_at IS NULL',
    { key: String(key || ''), at: Number(atMs) || Date.now() }
  );
  return Number(r.changes) > 0;
}

/** 整组重建成员边（真实成员；占位成员由 ext 承载，不进这张表）。 */
export function replaceMembers(conn, groupKey, members, atMs) {
  conn.run('DELETE FROM repo_group_members WHERE group_key = :g', { g: String(groupKey || '') });
  for (const m of members) {
    conn.run(
      `INSERT OR IGNORE INTO repo_group_members (group_key, repo_key, position, note, created_at)
       VALUES (:g, :r, :p, :n, :at)`,
      { g: String(groupKey || ''), r: String(m.repoKey || ''), p: Number(m.position) || 0, n: String(m.note || ''), at: atMs }
    );
  }
}

// ─── 队列绑定（T05 接通的写入口）──────────────────────────────────────

/** 挂在哨兵上的队列（cwd 非全局池的才有绑定意义；全局池永远挂哨兵）。 */
export function listUnboundTopics(conn = db()) {
  return conn.all(
    "SELECT id, key, cwd, group_key, name FROM topics WHERE repo_key = :s AND deleted_at IS NULL ORDER BY id",
    { s: SENTINEL_REPO_KEY }
  );
}

/** 把一条队列 re-point 到真实仓库（FK 已就位；key 改名时 CASCADE 跟随）。 */
export function bindTopicToRepo(conn, topicId, repoKey, atMs) {
  const r = conn.run(
    'UPDATE topics SET repo_key = :rk, updated_at = :at WHERE id = :id AND repo_key <> :rk',
    { rk: String(repoKey || ''), at: atMs, id: Number(topicId) }
  );
  return Number(r.changes) > 0;
}

/** 绑在该仓库上的队列数（删仓库前置检查 —— 级联会连带删队列，必须先挡）。 */
export function countTopicsOfRepo(repoKey, conn = db()) {
  const row = conn.get('SELECT count(*) AS c FROM topics WHERE repo_key = :r AND deleted_at IS NULL', {
    r: String(repoKey || ''),
  });
  return Number((row && row.c) || 0);
}

/** 绑在该组上下文下的队列数（topics.group_key 是 RESTRICT —— 删组前必须处理）。 */
export function countTopicsOfGroup(groupKey, conn = db()) {
  const row = conn.get('SELECT count(*) AS c FROM topics WHERE group_key = :g AND deleted_at IS NULL', {
    g: String(groupKey || ''),
  });
  return Number((row && row.c) || 0);
}

/**
 * 哨兵入组 / 哨兵绑队列的统一拒绝（D3 裁决：「未绑定」与「属于某组」互斥）。
 * @returns {boolean} true = 是哨兵
 */
export function isSentinelKey(key) {
  return String(key || '').trim() === SENTINEL_REPO_KEY;
}

/** 事务入口的窄转发（service 的多实体写经它包一个同步事务）。 */
export { txw };
