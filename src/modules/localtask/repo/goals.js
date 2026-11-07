// goals / goal_checks 的窄仓储（T06：timegoal 落库）。
//
// 一个任务一个目标（ux_goals_task：UNIQUE(task_id) WHERE deleted_at IS NULL，
// 实例型 —— 软删后同一任务可重设目标）。时间一律 epoch ms；三个派生值
// （elapsed / remaining / overtime）由调用方**存当日快照**，不许查时再算 ——
// deadline 会被延期（update 加时长），重算会把历史「当时还剩多久」改掉。
//
// 归档语义：goals.state = 'archived' + updated_at = 归档时刻。归档不是软删 ——
// 归档的目标仍可被 show/check 查到（agent 最后一轮要拿到 reached:true + prompt
// 原文才能收尾）；超过保留期的「自动失效」才是真删（连 goal_checks 级联）。
//
// goal_checks.summary 一列装两条内容：存 JSON `{summary, progress}` ——
// schema 没给 progress 单独的列（§12.2 审计裁决），而交付文本要它；统一 JSON
// 编码避免「分隔符被用户撞上」的歧义。人读稍差，机器解析零歧义。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';

/** 按任务取活动 goal（无则 null）。 */
export function getGoalByTask(taskId, conn = db()) {
  return (
    conn.get(
      'SELECT * FROM goals WHERE task_id = :t AND deleted_at IS NULL LIMIT 1',
      { t: Number(taskId) }
    ) || null
  );
}

/** 按内部 id 取 goal（含已归档；软删的查不到）。 */
export function getGoalById(id, conn = db()) {
  return conn.get('SELECT * FROM goals WHERE id = :id AND deleted_at IS NULL', { id: Number(id) }) || null;
}

/**
 * `task:<topicKey>:<seq>` → 带任务/队列信息的 goal 行（一条 JOIN 查完）。
 * 没有活动 goal、任务或队列对不上 → null。
 */
export function getGoalRowByTaskKey(topicKey, seq, conn = db()) {
  return (
    conn.get(
      `SELECT g.*, t.seq AS task_seq, tp.key AS topic_key, tp.cwd AS topic_cwd, tp.name AS topic_name
       FROM goals g
       JOIN tasks t ON t.id = g.task_id
       JOIN topics tp ON tp.id = t.topic_id
       WHERE tp.key = :k AND t.seq = :s AND t.deleted_at IS NULL AND g.deleted_at IS NULL
         AND tp.deleted_at IS NULL`,
      { k: String(topicKey || ''), s: Number(seq) }
    ) || null
  );
}

/**
 * 插入 goal（幂等：任务已有活动 goal 时不覆盖，返回已有行的 id）。
 * @returns {{id: number, existed: boolean}}
 */
export function insertGoal(conn, { taskId, durationSec, startedAtMs, deadlineMs, prompt = '', state = '', atMs }) {
  const at = Number(atMs) || nowMs();
  const r = conn.run(
    `INSERT INTO goals (task_id, duration_sec, started_at, deadline, prompt, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:t, :dur, :start, :deadline, :prompt, :state, 0, NULL, :at, :at)
     ON CONFLICT(task_id) WHERE deleted_at IS NULL DO NOTHING`,
    {
      t: Number(taskId),
      dur: Number(durationSec),
      start: Number(startedAtMs),
      deadline: Number(deadlineMs),
      prompt: String(prompt || ''),
      state: String(state || ''),
      at,
    }
  );
  const row = getGoalByTask(taskId, conn);
  return { id: Number(row.id), existed: Number(r.changes) === 0 };
}

/** 更新 prompt / 时长（保起点：deadline 由调用方按 started + 新时长算好传入）。 */
export function updateGoal(conn, goalId, { prompt, deadlineMs, durationSec } = {}, atMs = nowMs()) {
  const sets = [];
  const params = { id: Number(goalId), at: atMs };
  if (prompt !== undefined) {
    sets.push('prompt = :prompt');
    params.prompt = String(prompt);
  }
  if (durationSec !== undefined) {
    sets.push('duration_sec = :dur');
    params.dur = Number(durationSec);
  }
  if (deadlineMs !== undefined) {
    sets.push('deadline = :deadline');
    params.deadline = Number(deadlineMs);
  }
  if (!sets.length) return;
  sets.push('updated_at = :at');
  conn.run(`UPDATE goals SET ${sets.join(', ')} WHERE id = :id AND deleted_at IS NULL`, params);
}

/** 归档（到点自动归档）：state='archived'，归档时刻落在 updated_at。幂等。 */
export function archiveGoal(conn, goalId, atMs = nowMs()) {
  conn.run(
    "UPDATE goals SET state = 'archived', updated_at = :at WHERE id = :id AND deleted_at IS NULL AND state <> 'archived'",
    { id: Number(goalId), at: atMs }
  );
}

/** 真删（保留期已过的「自动失效」/ pruneExpired）。goal_checks 随 FK 级联。 */
export function purgeGoal(conn, goalId) {
  const r = conn.run('DELETE FROM goals WHERE id = :id', { id: Number(goalId) });
  return Number(r.changes) > 0;
}

/** 追加一条 check 流水（只增不改）。@returns {{id: number}} */
export function appendCheck(conn, { goalId, atMs, elapsedSec, remainingSec, overtimeSec, reached, summary, progress }) {
  const r = conn.run(
    `INSERT INTO goal_checks (goal_id, at, elapsed_sec, remaining_sec, overtime_sec, reached, summary)
     VALUES (:g, :at, :elapsed, :remaining, :overtime, :reached, :summary)`,
    {
      g: Number(goalId),
      at: Number(atMs),
      elapsed: Number(elapsedSec) || 0,
      remaining: Number(remainingSec) || 0,
      overtime: Number(overtimeSec) || 0,
      reached: reached ? 1 : 0,
      // progress 没有独立的列（schema §12.2）→ 与 summary 合一，统一 JSON 编码
      summary: JSON.stringify({ summary: String(summary || ''), progress: String(progress || '') }),
    }
  );
  return { id: Number(r.lastInsertRowid) };
}

/** goal 的全部 check 流水（时间升序 = 追加序；行级追加不封顶）。 */
export function listChecks(goalId, conn = db()) {
  return conn.all('SELECT * FROM goal_checks WHERE goal_id = :g ORDER BY at, rowid', { g: Number(goalId) });
}

/** goal 的 check 总数（不加载流水；行级追加用 count，不再有 logTruncated 概念）。 */
export function countChecks(goalId, conn = db()) {
  const row = conn.get('SELECT count(*) AS c FROM goal_checks WHERE goal_id = :g', { g: Number(goalId) });
  return Number((row && row.c) || 0);
}

/** 全部活动 goal 行（list / prune / 到点扫描用；join 任务与队列拿 cwd/name）。 */
export function listGoalRows(conn = db()) {
  return conn.all(
    `SELECT g.*, t.seq AS task_seq, tp.key AS topic_key, tp.cwd AS topic_cwd, tp.name AS topic_name
     FROM goals g
     JOIN tasks t ON t.id = g.task_id
     JOIN topics tp ON tp.id = t.topic_id
     WHERE g.deleted_at IS NULL AND t.deleted_at IS NULL AND tp.deleted_at IS NULL
     ORDER BY g.deadline`
  );
}

/** 事务入口的窄转发。 */
export { txw };
