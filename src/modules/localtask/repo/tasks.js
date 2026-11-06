// 任务仓储：tasks / task_deps 的窄方法。每个写方法 = 一个事务（嵌套自动 SAVEPOINT）。
//
// 三个刻意的设计点：
//   1. **claim 是带守卫的单条 UPDATE**（`WHERE status='pending' AND deleted_at IS NULL`）：
//      两个进程同时领同一条时，只有一个 UPDATE 生效（changes=0 的一方拿不到）。
//      「并发领取不重复」由此成为结构性保证，不靠进程间协调。
//   2. **blockBy 拆两处存**：本地数字依赖 → task_deps 行（外键可校验）；
//      跨队列 "key:id" 引用 → ext.ext_deps_foreign（绝对地址，搬家不失效）。
//      读的时候在 rowToTask 里合并回一个 blockBy 数组 —— 视图层看不见差别。
//   3. **队列顺序不在这里**：seq 是对外编号、不可变（trg_tasks_identity 锁死），
//      顺序在 topics.ext.ext_task_order（见 repo/topics.js 顶部说明）。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';
import { EXT, parseExt, jsonText, rowToTask, splitTaskFields } from './rows.js';

/** 主题的下一个编号（next_seq 列维护，等价于旧 nextTaskId 的 max+1）。 */
export function nextSeq(topicId, conn = null) {
  const c = conn || db();
  const row = c.get('SELECT next_seq FROM topics WHERE id = :id', { id: topicId });
  return Math.max(1, Number((row && row.next_seq) || 1));
}

/** 单主题内推进 next_seq（并发插入靠事务串行化，同 JSON 时代的进程内单写）。 */
function advanceSeq(topicId, conn) {
  const n = nextSeq(topicId, conn);
  conn.run('UPDATE topics SET next_seq = :n WHERE id = :id', { n: n + 1, id: topicId });
  return n;
}

function extOf(conn, topicId, seq) {
  const row = conn.get('SELECT ext FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
  return parseExt(row && row.ext);
}

function mergeExt(conn, topicId, seq, patch) {
  const ext = { ...extOf(conn, topicId, seq) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete ext[k];
    else ext[k] = v;
  }
  conn.run('UPDATE tasks SET ext = :ext WHERE topic_id = :t AND seq = :s', {
    ext: jsonText(ext),
    t: topicId,
    s: seq,
  });
}

/** 本地依赖整组重写（task_deps 是逐对边；「这条任务挡在这些后面」就是块级语义）。 */
function writeLocalDeps(conn, taskId, depsLocal) {
  conn.run('DELETE FROM task_deps WHERE task_id = :id', { id: taskId });
  for (const dep of depsLocal || []) {
    conn.run('INSERT OR IGNORE INTO task_deps (task_id, dep_id, created_at) VALUES (:t, :d, :at)', {
      t: taskId,
      d: Number(dep),
      at: nowMs(),
    });
  }
}

/** 行 + 依赖 → { row, task }（task 是 JSON 形态）。 */
function rowToTaskWithDeps(conn, row) {
  const deps = conn
    .all('SELECT dep_id FROM task_deps WHERE task_id = :id ORDER BY dep_id', { id: row.id })
    .map((r) => Number(r.dep_id))
    .filter((n) => Number.isFinite(n) && n > 0);
  return { row, task: rowToTask({ ...row, depsLocal: deps }) };
}

/**
 * 插入一条任务。`task` 是 JSON 形态（text/status/createdAt/consumedAt/...），
 * 缺省与旧 store 的「normalizeTask + push」一致：status='pending'、createdAt=now。
 * @returns {{id: number, task: object}}
 */
export function insertTask(topicId, task = {}) {
  return txw((conn) => {
    const at = nowMs();
    const seq = Number(task.id) || advanceSeq(topicId, conn);
    // 显式给了编号（引擎造节点 / 搬队列）也要把 next_seq 顶过去 —— 否则下一批
    // addTask 会从旧值重新编号，撞主键 (topic_id, seq)。
    conn.run('UPDATE topics SET next_seq = MAX(next_seq, :n) WHERE id = :id', {
      n: seq + 1,
      id: topicId,
    });
    const fields = splitTaskFields({ status: 'pending', createdAt: undefined, ...task });
    const c = fields.columns;
    conn.run(
      `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                          from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                          created_at, updated_at)
       VALUES (:t, :s, '', :status, 0, :body, :ext, :feedback, NULL,
               :fromSrc, :blocksFollowing, :claimedAtMs, :doneAtMs, :round, :deletedAtMs,
               :createdAtMs, :at)`,
      {
        t: topicId,
        s: seq,
        status: c.status || 'pending',
        body: c.body ?? '',
        ext: jsonText(fields.ext),
        feedback: c.feedback ?? '',
        fromSrc: c.fromSrc ?? '',
        blocksFollowing: c.blocksFollowing ?? 0,
        claimedAtMs: c.claimedAtMs ?? null,
        doneAtMs: c.doneAtMs ?? null,
        round: c.round ?? 1,
        deletedAtMs: c.deletedAtMs ?? null,
        // createdAt 缺省 = 现在（旧行为：发布时刻）
        createdAtMs: c.createdAtMs ?? at,
        at,
      }
    );
    const row = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
    writeLocalDeps(conn, Number(row.id), fields.depsLocal);
    return { id: seq, task: getTaskRow(topicId, seq, conn).task };
  });
}

/** 查一条任务（JSON 形态，含 deps / ext）；不存在返回 null。 */
export function getTaskRow(topicId, seq, conn = null) {
  const c = conn || db();
  const row = c.get(`SELECT id, topic_id AS topicId, seq, type, status, version, body, ext, feedback,
       feedback_at AS feedbackAt, from_src AS fromSrc, blocks_following AS blocksFollowing,
       claimed_at AS claimedAtMs, done_at AS doneAtMs, round, deleted_at AS deletedAtMs,
       created_at AS createdAtMs, updated_at AS updatedAtMs
  FROM tasks WHERE topic_id = :t AND seq = :s`, { t: topicId, s: seq });
  if (!row) return null;
  return rowToTaskWithDeps(c, row);
}

/**
 * 一个主题的全部任务（JSON 形态数组，seq 序）。
 * 真正的队列顺序由 repo/topics.js 的 assembleTopic 按 ext_task_order 重排。
 */
export function listTaskRowsByTopic(topicId, conn = null) {
  const c = conn || db();
  const rows = c.all(`SELECT id, topic_id AS topicId, seq, type, status, version, body, ext, feedback,
       feedback_at AS feedbackAt, from_src AS fromSrc, blocks_following AS blocksFollowing,
       claimed_at AS claimedAtMs, done_at AS doneAtMs, round, deleted_at AS deletedAtMs,
       created_at AS createdAtMs, updated_at AS updatedAtMs
  FROM tasks WHERE topic_id = :t ORDER BY seq`, { t: topicId });
  return rows.map((row) => rowToTaskWithDeps(c, row));
}

/** 全库任务（跨主题总览用），带 topicKey。 */
export function listAllTaskRows(conn = null) {
  const c = conn || db();
  const rows = c.all(
    `SELECT t.id, t.topic_id AS topicId, t.seq, t.type, t.status, t.version, t.body, t.ext, t.feedback,
            t.feedback_at AS feedbackAt, t.from_src AS fromSrc, t.blocks_following AS blocksFollowing,
            t.claimed_at AS claimedAtMs, t.done_at AS doneAtMs, t.round, t.deleted_at AS deletedAtMs,
            t.created_at AS createdAtMs, t.updated_at AS updatedAtMs, k.key AS topic_key
       FROM tasks t JOIN topics k ON k.id = t.topic_id ORDER BY t.topic_id, t.seq`
  );
  return rows.map((row) => {
    const { task } = rowToTaskWithDeps(c, row);
    return { task, topicKey: String(row.topic_key), topicId: Number(row.topic_id) };
  });
}

/**
 * 带守卫的领取：只有 `pending ∧ 未删除` 的行会被更新。
 * @returns {object|null} 领取成功返回 JSON 形态任务；被人抢先/已删返回 null。
 */
export function claimTask(
  topicId,
  seq,
  { summary = '', from = '', byKey = '', byName = '', atMs = nowMs() } = {}
) {
  return txw((conn) => {
    // summary = 领取方本轮的现状（wait 的 --summary）。JSON 时代它落在 roundSummary，
    // done 时被交付结论覆盖 —— 这里同样落 feedback 列（done 的 UPDATE 会整格覆写）。
    const r = conn.run(
      `UPDATE tasks SET status = 'claimed', claimed_at = :at, feedback = :fb, updated_at = :at
        WHERE topic_id = :t AND seq = :s AND status = 'pending' AND deleted_at IS NULL`,
      { t: topicId, s: seq, at: atMs, fb: String(summary ?? '') }
    );
    if (Number(r.changes) !== 1) return null;
    mergeExt(conn, topicId, seq, {
      [EXT.CLAIMED_FROM]: String(from || ''),
      [EXT.CLAIMED_BY]: String(byKey || ''),
      [EXT.CLAIMED_BY_NAME]: String(byName || ''),
    });
    return getTaskRow(topicId, seq, conn).task;
  });
}

/** 带守卫的完成：只有 `claimed ∧ 未删除` 会写成 done（feedback 必填由调用方保证）。 */
export function completeTask(topicId, seq, { feedback = '', atMs = nowMs() } = {}) {
  return txw((conn) => {
    const r = conn.run(
      `UPDATE tasks SET status = 'done', done_at = :at, feedback_at = :at, feedback = :fb, updated_at = :at
        WHERE topic_id = :t AND seq = :s AND status = 'claimed' AND deleted_at IS NULL`,
      { t: topicId, s: seq, at: atMs, fb: String(feedback ?? '') }
    );
    return Number(r.changes) === 1;
  });
}

/**
 * 字段级更新（reopen / update / 软删 / 恢复都用它）。
 * `patch` 是 JSON 形态的字段子集；写不进任何列的低频字段进 ext。
 * @returns {object|null} 更新后的 JSON 形态任务
 */
export function updateTask(topicId, seq, patch = {}) {
  return txw((conn) => {
    const cur = getTaskRow(topicId, seq, conn);
    if (!cur) return null;
    const merged = { ...cur.task, ...patch };
    const fields = splitTaskFields(merged);
    const sets = [];
    const params = { t: topicId, s: seq, at: nowMs() };
    const colMap = {
      body: 'body',
      status: 'status',
      feedback: 'feedback',
      claimedAtMs: 'claimed_at',
      doneAtMs: 'done_at',
      deletedAtMs: 'deleted_at',
      fromSrc: 'from_src',
      blocksFollowing: 'blocks_following',
      round: 'round',
      // created_at 故意不在列：它是身份（trg_tasks_identity 锁死），且 ms→秒级串→ms
      // 的往返会截断毫秒，把"重写同值"变成"改身份"。
    };
    for (const [k, col] of Object.entries(colMap)) {
      const v = fields.columns[k];
      if (v === undefined) continue;
      sets.push(`${col} = :${k}`);
      params[k] = v;
    }
    sets.push('ext = :ext');
    params.ext = jsonText({ ...extOf(conn, topicId, seq), ...fields.ext });
    sets.push('updated_at = :at');
    conn.run(`UPDATE tasks SET ${sets.join(', ')} WHERE topic_id = :t AND seq = :s`, params);
    writeLocalDeps(conn, Number(cur.row.id), fields.depsLocal);
    return getTaskRow(topicId, seq, conn).task;
  });
}

/** 按 topic key 定位的字段更新（测试 / 外部写模拟用；语义同 updateTask）。 */
export function updateTaskByKey(key, seq, patch = {}) {
  const t = db().get('SELECT id FROM topics WHERE key = :key', { key });
  if (!t) return null;
  return updateTask(Number(t.id), seq, patch);
}

/** 彻底删除一行（purge）。软删除走 updateTask({ deletedAt })。 */
export function purgeTask(topicId, seq) {
  return txw((conn) => {
    const row = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
    if (!row) return false;
    conn.run('DELETE FROM task_deps WHERE task_id = :id', { id: row.id });
    conn.run('DELETE FROM task_deps WHERE dep_id = :id', { id: row.id });
    const r = conn.run('DELETE FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
    return Number(r.changes) === 1;
  });
}

/**
 * 搬队列：把一行挪到另一个主题（topic_id 改写；编号让位于目标队列的 next_seq ——
 * 目标队列可能已有同号任务，两个队列各自从 1 编号，撞号是常态；这与 JSON 时代
 * 「整行 push 进目标数组、id 按目标队列 nextTaskId 重新分配」一致）。
 * @returns {{task: object, fromSeq: number, toSeq: number}|null}
 */
export function moveTaskToTopic(fromTopicId, seq, toTopicId) {
  return txw((conn) => {
    const src = conn.get('SELECT * FROM tasks WHERE topic_id = :t AND seq = :s', { t: fromTopicId, s: seq });
    if (!src) return null;
    const clash = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: toTopicId, s: seq });
    const targetSeq = clash ? advanceSeq(toTopicId, conn) : seq;
    conn.run(
      `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                          from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                          created_at, updated_at)
       SELECT :to, :s, type, status, version, body, ext, feedback, feedback_at,
              from_src, blocks_following, claimed_at, done_at, round, deleted_at,
              created_at, :at
         FROM tasks WHERE id = :id`,
      { to: toTopicId, s: targetSeq, id: src.id, at: nowMs() }
    );
    const newRow = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', {
      t: toTopicId,
      s: targetSeq,
    });
    // 依赖边跟着搬：本地依赖引用的是「源队列的编号」，搬走后指向可能失效；
    // JSON 时代 relocateInStore 的守卫（queueRelationsOf）保证只有无队列内关系的
    // 任务能搬，所以这里只需原样迁移边。
    conn.run('UPDATE task_deps SET task_id = :new WHERE task_id = :old', { new: newRow.id, old: src.id });
    conn.run('DELETE FROM task_deps WHERE dep_id = :old', { old: src.id });
    conn.run('DELETE FROM tasks WHERE id = :id', { id: src.id });
    // 无 clash 的分支同样要顶 next_seq：否则搬完之后 nextSeq 还停在旧值，
    // 下一条 addTask 会算出与搬入任务相同的编号（主键冲突）。
    conn.run('UPDATE topics SET next_seq = MAX(next_seq, :n) WHERE id = :id', {
      n: targetSeq + 1,
      id: toTopicId,
    });
    return { task: getTaskRow(toTopicId, targetSeq, conn).task, fromSeq: seq, toSeq: targetSeq };
  });
}

/** 闸门判定用的存在性查询：同队列里排在我前面、还没被领走的闸门（走 ix_tasks_pending）。 */
export function hasBlockingGate(topicId, seq, conn = null) {
  const c = conn || db();
  return !!c.get(
    `SELECT 1 FROM tasks g
      WHERE g.topic_id = :t AND g.seq < :s
        AND g.status = 'pending' AND g.deleted_at IS NULL AND g.blocks_following = 1
      LIMIT 1`,
    { t: topicId, s: seq }
  );
}
