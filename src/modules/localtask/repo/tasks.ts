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
import { syncTaskAttachments } from '../../../core/attachmentdb.js';
import type { DbApi } from '../../../core/db/driver.js';
import type { TaskObject } from './rows.js';

/** 任务行查询结果：原始 DB 行 + JSON 形态任务。 */
export interface TaskRowWithDeps {
  row: Record<string, any>;
  task: TaskObject;
}

/** 任务 patch（JSON 形态的字段子集；低频字段进 ext）。 */
export type TaskPatch = Record<string, any>;

// 行查询的统一列清单（camelCase 别名 = rowToTask 的入参形状）
const TASK_SELECT = `SELECT id, topic_id AS topicId, seq, type, status, version, body, ext, feedback,
       feedback_at AS feedbackAt, from_src AS fromSrc, blocks_following AS blocksFollowing,
       claimed_at AS claimedAtMs, done_at AS doneAtMs, round, deleted_at AS deletedAtMs,
       created_at AS createdAtMs, updated_at AS updatedAtMs
  FROM tasks`;

/** 主题的下一个编号（next_seq 列维护，等价于旧 nextTaskId 的 max+1）。 */
export function nextSeq(topicId: number, conn: DbApi | null = null): number {
  const c = conn || db();
  const row = c.get('SELECT next_seq FROM topics WHERE id = :id', { id: topicId });
  return Math.max(1, Number((row && row.next_seq) || 1));
}

/**
 * 单主题内原子取号：`UPDATE ... RETURNING` 让「读 next_seq → 写回」不再分两步，
 * 事务串行化下两个进程各拿一个不同编号；调用方必须在同一个事务里调用（insertTask 已保证）。
 */
function takeSeq(topicId: number, conn: DbApi): number {
  const row = conn.get(
    'UPDATE topics SET next_seq = next_seq + 1 WHERE id = :id RETURNING next_seq - 1 AS seq',
    { id: topicId }
  );
  if (!row) throw new Error(`主题 ${topicId} 不存在，无法分配任务编号`);
  return Math.max(1, Number(row.seq));
}

function extOf(conn: DbApi, topicId: number, seq: number): Record<string, any> {
  const row = conn.get('SELECT ext FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
  return parseExt(row && row.ext);
}

function mergeExt(conn: DbApi, topicId: number, seq: number, patch: Record<string, any>): void {
  const ext = { ...extOf(conn, topicId, seq) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete ext[k];
    else ext[k] = v;
  }
  conn.run('UPDATE tasks SET ext = :ext, version = version + 1 WHERE topic_id = :t AND seq = :s', {
    ext: jsonText(ext),
    t: topicId,
    s: seq,
  });
}

/**
 * 本地依赖整组重写（task_deps 是逐对边；「这条任务挡在这些后面」就是块级语义）。
 *
 * 边存的是**全局 tasks.id**（外键列），而 JSON 形态的 blockBy 是**主题内 seq**。
 * 多队列下两者不相等：写入时按 (topic_id, seq) 解析，读时反向解析，视图层仍只见 seq。
 */
function writeLocalDeps(conn: DbApi, topicId: number, taskId: number, depsLocal?: unknown[]): void {
  conn.run('DELETE FROM task_deps WHERE task_id = :id', { id: taskId });
  for (const dep of depsLocal || []) {
    const depSeq = Number(dep);
    if (!Number.isFinite(depSeq) || depSeq <= 0) continue;
    const dr = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', {
      t: topicId,
      s: depSeq,
    });
    if (!dr) continue; // 依赖指到不存在的任务：与旧 store 一样当坏输入忽略
    const depId = Number(dr.id);
    if (depId === Number(taskId)) continue; // 自依赖无意义
    conn.run('INSERT OR IGNORE INTO task_deps (task_id, dep_id, created_at) VALUES (:t, :d, :at)', {
      t: taskId,
      d: depId,
      at: nowMs(),
    });
  }
}

/** 行 + 依赖 + 派生子任务数 → { row, task }（依赖从全局 id 反解成同主题 seq）。 */
function rowToTaskWithDeps(conn: DbApi, row: Record<string, any>): TaskRowWithDeps {
  const deps = conn
    .all(
      `SELECT d.seq AS depSeq
         FROM task_deps td JOIN tasks d ON d.id = td.dep_id
        WHERE td.task_id = :id AND d.topic_id = :t
        ORDER BY d.seq`,
      { id: row.id, t: row.topicId }
    )
    .map((r) => Number(r.depSeq))
    .filter((n) => Number.isFinite(n) && n > 0);
  // 派生子任务数（#144）：>0 = 已有后续轮次/评论派生，面板据此收起反馈入口
  // 派生「下一轮」数（#172）：只有 reopen 边 = **同一件活儿继续下一轮** → 本条
  // 不是链尖（面板只留链尖，旧轮次去任务链里看）。comment / feedback 边是
  // **旁支新活**（评论派生 / 反馈里提的新需求），父任务照旧是活的，不算被取代。
  const child = conn.get(
    `SELECT count(*) AS n,
            sum(CASE WHEN type = 'reopen' THEN 1 ELSE 0 END) AS rounds
       FROM task_links WHERE dst_id = :id`,
    { id: row.id }
  );
  return {
    row,
    task: rowToTask({
      ...row,
      depsLocal: deps,
      childCount: Number(child && child.n) || 0,
      childRoundCount: Number(child && child.rounds) || 0,
    }),
  };
}

/**
 * 插入一条任务。`task` 是 JSON 形态（text/status/createdAt/consumedAt/...），
 * 缺省与旧 store 的「normalizeTask + push」一致：status='pending'、createdAt=now。
 * @returns {{id: number, task: object}}
 */
export function insertTask(topicId: number, task: TaskPatch = {}): { id: number; task: TaskObject } {
  return txw((conn) => {
    const at = nowMs();
    // 编号必须在同一个事务里取：事务外的 next_seq 会被别的进程同时读到，
    // 两边拿同一个号 → INSERT 撞 UNIQUE(topic_id, seq)。
    const explicit = Number(task.id);
    let seq: number;
    if (Number.isFinite(explicit) && explicit > 0) {
      // 显式给了编号（引擎造节点 / 搬队列）也要把 next_seq 顶过去 —— 否则下一批
      // addTask 会从旧值重新编号，撞主键 (topic_id, seq)。
      seq = Math.trunc(explicit);
      conn.run('UPDATE topics SET next_seq = MAX(next_seq, :n) WHERE id = :id', {
        n: seq + 1,
        id: topicId,
      });
    } else {
      seq = takeSeq(topicId, conn);
    }
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
    writeLocalDeps(conn, topicId, Number(row.id), fields.depsLocal);
    // 正文里已经写了 fileId / nxkv 链接：入库即建资源关系，不等到领取才解析。
    syncTaskAttachments(conn, { taskId: Number(row.id), text: c.body ?? '', atMs: at });
    return { id: seq, task: getTaskRow(topicId, seq, conn)!.task };
  });
}

/** 查一条任务（JSON 形态，含 deps / ext）；不存在返回 null。 */
export function getTaskRow(topicId: number, seq: number, conn: DbApi | null = null): TaskRowWithDeps | null {
  const c = conn || db();
  const row = c.get(`${TASK_SELECT} WHERE topic_id = :t AND seq = :s`, { t: topicId, s: seq });
  if (!row) return null;
  return rowToTaskWithDeps(c, row);
}

/** 按内部主键取任务行（链节点用：链存的是全局 tasks.id）。 */
export function getTaskRowById(id: number, conn: DbApi | null = null): TaskRowWithDeps | null {
  const c = conn || db();
  const row = c.get(`${TASK_SELECT} WHERE id = :id`, { id });
  if (!row) return null;
  return rowToTaskWithDeps(c, row);
}

/**
 * 一个主题的全部任务（JSON 形态数组，seq 序）。
 * 真正的队列顺序由 repo/topics.js 的 assembleTopic 按 ext_task_order 重排。
 */
export function listTaskRowsByTopic(topicId: number, conn: DbApi | null = null): TaskRowWithDeps[] {
  const c = conn || db();
  const rows = c.all(`${TASK_SELECT} WHERE topic_id = :t ORDER BY seq`, { t: topicId });
  return rows.map((row) => rowToTaskWithDeps(c, row));
}

/** 全库任务（跨主题总览用），带 topicKey。软删主题下的任务不出现（祖先过滤）。 */
export function listAllTaskRows(conn: DbApi | null = null): Array<{ task: TaskObject; topicKey: string; topicId: number }> {
  const c = conn || db();
  const rows = c.all(
    `SELECT t.id, t.topic_id AS topicId, t.seq, t.type, t.status, t.version, t.body, t.ext, t.feedback,
            t.feedback_at AS feedbackAt, t.from_src AS fromSrc, t.blocks_following AS blocksFollowing,
            t.claimed_at AS claimedAtMs, t.done_at AS doneAtMs, t.round, t.deleted_at AS deletedAtMs,
            t.created_at AS createdAtMs, t.updated_at AS updatedAtMs, k.key AS topic_key
       FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.deleted_at IS NULL
      ORDER BY t.topic_id, t.seq`
  );
  return rows.map((row) => {
    const { task } = rowToTaskWithDeps(c, row);
    return { task, topicKey: String(row.topic_key), topicId: Number(row.topicId) };
  });
}

/** claimTask / closeOpenTask 的共同选项（atMs 缺省 = 现在时刻）。 */
export interface ClaimOptions {
  summary?: string;
  from?: string;
  byKey?: string;
  byName?: string;
  atMs?: number;
}

/**
 * 带守卫的领取：只有 `pending ∧ 未删除` 的行会被更新。
 * @returns {object|null} 领取成功返回 JSON 形态任务；被人抢先/已删返回 null。
 */
export function claimTask(
  topicId: number,
  seq: number,
  { summary = '', from = '', byKey = '', byName = '', atMs = nowMs() }: ClaimOptions = {}
): TaskObject | null {
  return txw((conn) => {
    // summary = 领取方本轮的现状（wait 的 --summary）。JSON 时代它落在 roundSummary，
    // done 时被交付结论覆盖 —— 这里同样落 feedback 列（done 的 UPDATE 会整格覆写）。
    const r = conn.run(
      `UPDATE tasks SET status = 'claimed', claimed_at = :at, feedback = :fb, version = version + 1,
              updated_at = :at
        WHERE topic_id = :t AND seq = :s AND status = 'pending' AND deleted_at IS NULL`,
      { t: topicId, s: seq, at: atMs, fb: String(summary ?? '') }
    );
    if (Number(r.changes) !== 1) return null;
    mergeExt(conn, topicId, seq, {
      [EXT.CLAIMED_FROM]: String(from || ''),
      [EXT.CLAIMED_BY]: String(byKey || ''),
      [EXT.CLAIMED_BY_NAME]: String(byName || ''),
    });
    return getTaskRow(topicId, seq, conn)!.task;
  });
}

/** 带守卫的完成：只有 `claimed ∧ 未删除` 会写成 done（feedback 必填由调用方保证）。 */
export function completeTask(topicId: number, seq: number, { feedback = '', atMs = nowMs() }: { feedback?: string; atMs?: number } = {}): boolean {
  return txw((conn) => {
    const r = conn.run(
      `UPDATE tasks SET status = 'done', done_at = :at, feedback_at = :at, feedback = :fb,
              version = version + 1, updated_at = :at
        WHERE topic_id = :t AND seq = :s AND status = 'claimed' AND deleted_at IS NULL`,
      { t: topicId, s: seq, at: atMs, fb: String(feedback ?? '') }
    );
    return Number(r.changes) === 1;
  });
}

/**
 * 用户侧收口「还没结束」的任务（面板「标为完成 / 取消任务」）：**不要求先领取**。
 *
 * 守卫是 `pending ∨ claimed`（#184）：正在跑的任务（claimed）以前在面板上是死路——
 * 菜单里连「标为完成」都不渲染，只能等 agent 自己回执。现在两态都能收：
 * - pending：任务还没人要，用户直接判定做完了 / 不做了；
 * - claimed：agent 正拿着这条在跑，用户从面板直接拍板（agent 稍后再调 done 会命中
 *   幂等分支，不会报错，见 task-lifecycle 的 done 早返回）。
 * done 写完成时刻 + 总结，cancelled 只改状态（与批量取消同口径）；都不动 claimed_* 审计列。
 */
export function closeOpenTask(topicId: number, seq: number, { status = 'done', feedback = '', atMs = nowMs() }: { status?: string; feedback?: string; atMs?: number } = {}): boolean {
  const isDone = String(status) === 'done';
  return txw((conn) => {
    const r = isDone
      ? conn.run(
          `UPDATE tasks SET status = 'done', done_at = :at, feedback_at = :at, feedback = :fb,
                  version = version + 1, updated_at = :at
            WHERE topic_id = :t AND seq = :s AND status IN ('pending', 'claimed') AND deleted_at IS NULL`,
          { t: topicId, s: seq, at: atMs, fb: String(feedback ?? '') }
        )
      : conn.run(
          `UPDATE tasks SET status = 'cancelled', version = version + 1, updated_at = :at
            WHERE topic_id = :t AND seq = :s AND status IN ('pending', 'claimed') AND deleted_at IS NULL`,
          { t: topicId, s: seq, at: atMs }
        );
    return Number(r.changes) === 1;
  });
}

/**
 * 字段级更新（reopen / update / 软删 / 恢复都用它）。
 * `patch` 是 JSON 形态的字段子集；写不进任何列的低频字段进 ext。
 * @returns {object|null} 更新后的 JSON 形态任务
 */
export function updateTask(topicId: number, seq: number, patch: TaskPatch = {}): TaskObject | null {
  return txw((conn) => {
    const cur = getTaskRow(topicId, seq, conn);
    if (!cur) return null;
    const merged = { ...cur.task, ...patch };
    const fields = splitTaskFields(merged);
    const sets: string[] = [];
    const params: Record<string, any> = { t: topicId, s: seq, at: nowMs() };
    const colMap: Record<string, string> = {
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
    // version 是行版本（只递增、不做乐观锁校验）：每次字段更新都前进一格，
    // 它就不再是死列，还能给外部同步/审计一个廉价的变更判据。
    sets.push('version = version + 1');
    sets.push('updated_at = :at');
    conn.run(`UPDATE tasks SET ${sets.join(', ')} WHERE topic_id = :t AND seq = :s`, params);
    writeLocalDeps(conn, topicId, Number(cur.row.id), fields.depsLocal);
    // 只有正文真的变了才重写资源关系：status/feedback 更新不动 task_attach。
    if (patch.text !== undefined || patch.body !== undefined) {
      syncTaskAttachments(conn, {
        taskId: Number(cur.row.id),
        text: merged.text ?? fields.columns.body ?? '',
        atMs: params.at,
      });
    }
    return getTaskRow(topicId, seq, conn)!.task;
  });
}

/** 按 topic key 定位的字段更新（测试 / 外部写模拟用；语义同 updateTask）。 */
export function updateTaskByKey(key: string, seq: number, patch: TaskPatch = {}): TaskObject | null {
  const t = db().get('SELECT id FROM topics WHERE key = :key', { key });
  if (!t) return null;
  return updateTask(Number(t.id), seq, patch);
}

/** 彻底删除一行（purge）。软删除走 updateTask({ deletedAt })。 */
export function purgeTask(topicId: number, seq: number): boolean {
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
 * （T04 后已删除 moveTaskToTopic：搬队列改走派生模型 —— task-view.js 的
 * relocateTask 派生新任务 + 软删原任务，绝不再 UPDATE seq/created_at。
 * `trg_tasks_identity` 的收窄条件保留：同队列改号仍 ABORT，语义正确。）
 */

/** 闸门判定用的存在性查询：同队列里排在我前面、还没被领走的闸门（走 ix_tasks_pending）。 */
export function hasBlockingGate(topicId: number, seq: number, conn: DbApi | null = null): boolean {
  const c = conn || db();
  return !!c.get(
    `SELECT 1 FROM tasks g
      WHERE g.topic_id = :t AND g.seq < :s
        AND g.status = 'pending' AND g.deleted_at IS NULL AND g.blocks_following = 1
      LIMIT 1`,
    { t: topicId, s: seq }
  );
}
