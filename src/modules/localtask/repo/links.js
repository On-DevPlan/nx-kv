// 派生链仓储（T04）：task_links 是链的唯一来源。
//
// 三个动词（来自 schema 注释与设计 §D2）：
//   comment  由某条评论派生（评论区划选 → 新任务）
//   reopen   重开：上一轮没通过，另起一条接着做
//   feedback 完成回调的反馈里提出了新活
//
// 结构约束（schema 已锁死，这里只做业务口径）：
//   · 一个任务只有一个来源（ux_task_links_parent）→ 链是树不是网
//   · 方向恒为 新(src) → 旧(dst)，反查子任务走 ix_task_links_children
//   · 依附全局 tasks.id：任务搬队列链不断
//
// 读形状：`chainOf` 一次递归查询拿整条链（祖先 + 自己 + 后代），
// 列表页的"这条派生了几个"用 childrenCount（走 ix_task_links_children）。
import { db, txw } from './open.js';
import { badInput, notFound } from '../../../core/errors.js';

/** 合法的派生类型（与 schema CHECK 同口径，写前校验给可读报错）。 */
export const LINK_TYPES = Object.freeze(['comment', 'reopen', 'feedback']);

function taskRowById(conn, id) {
  return conn.get(
    `SELECT id, topic_id AS topicId, seq, type, status, version, body, ext, feedback,
            feedback_at AS feedbackAt, from_src AS fromSrc, blocks_following AS blocksFollowing,
            claimed_at AS claimedAtMs, done_at AS doneAtMs, round, deleted_at AS deletedAtMs,
            created_at AS createdAtMs, updated_at AS updatedAtMs
       FROM tasks WHERE id = :id`,
    { id }
  );
}

/**
 * 加一条派生边（src=新任务，dst=来源任务）。
 * 必须在调用方的事务里（新任务插入与链写入同一次落盘）。
 * @param {object} p { srcId, dstId, type, note?, atMs? }
 * @throws 业务口径错误（类型非法 / 自派生 / 来源已有链）——schema 会兜底，这里先给可读报错
 */
export function addLink({ srcId, dstId, type, note = '', atMs = Date.now() }) {
  return txw((conn) => {
    if (!LINK_TYPES.includes(type)) {
      throw badInput(`派生类型必须是 ${LINK_TYPES.join('/')}，收到 ${JSON.stringify(type)}`);
    }
    if (Number(srcId) === Number(dstId)) {
      throw badInput('不能从自己派生（src = dst）');
    }
    const parent = taskRowById(conn, dstId);
    if (!parent) {
      throw notFound(`来源任务不存在（tasks.id=${dstId}）`);
    }
    conn.run(
      `INSERT INTO task_links (src_id, dst_id, type, note, created_at)
       VALUES (:src, :dst, :type, :note, :at)`,
      { src: srcId, dst: dstId, type, note: String(note ?? ''), at: atMs }
    );
    return true;
  });
}

/** 这个任务有没有"来源"（是否派生过）。 */
export function hasParent(taskId) {
  return !!db().get('SELECT src_id FROM task_links WHERE src_id = :id', { id: taskId });
}

/** 来源边（含类型与备注）；没有来源返回 null。 */
export function parentLink(taskId) {
  return db().get(
    'SELECT src_id, dst_id, type, note, created_at AS atMs FROM task_links WHERE src_id = :id',
    { id: taskId }
  );
}

/** 子任务数（列表页"这条派生了几个"走 ix_task_links_children）。 */
export function childrenCount(taskId) {
  const row = db().get('SELECT count(*) AS c FROM task_links WHERE dst_id = :id', { id: taskId });
  return Number((row && row.c) || 0);
}

/** 直接子任务（seq + 内部 id + 链类型），按创建序。 */
export function childLinks(taskId) {
  return db()
    .all(
      `SELECT l.src_id AS srcId, l.type, l.note, l.created_at AS atMs, t.seq
         FROM task_links l JOIN tasks t ON t.id = l.src_id
        WHERE l.dst_id = :id ORDER BY l.created_at, t.seq`,
      { id: taskId }
    )
    .map((r) => ({ ...r, srcId: Number(r.srcId), seq: Number(r.seq), atMs: Number(r.atMs) }));
}

/**
 * 整条链：一次递归查询拿祖先（到根），一次拿全部后代，自身夹在中间。
 * 返回节点按"根 → … → 自己 → … → 叶"排序，每节点带 depth（相对自己：祖先为负）。
 *
 * 不做全 store 扫描：祖先走递归 CTE，后代走 ix_task_links_children。
 * @param {number} taskId tasks.id（内部主键）
 */
export function chainOf(taskId) {
  const conn = db();
  const id = Number(taskId);
  // 祖先（到根）：depth 1 = 直接来源
  const ancestors = conn
    .all(
      `WITH RECURSIVE up(id, type, note, depth) AS (
         SELECT dst_id, type, note, 1 FROM task_links WHERE src_id = :id
         UNION ALL
         SELECT l.dst_id, l.type, l.note, up.depth + 1
           FROM task_links l JOIN up ON l.src_id = up.id
       )
       SELECT up.id, up.type, up.note, up.depth, t.seq
         FROM up JOIN tasks t ON t.id = up.id
        ORDER BY up.depth`,
      { id }
    )
    .map((r) => ({ ...r, id: Number(r.id), seq: Number(r.seq), depth: Number(r.depth) }));
  // 后代（所有代）
  const descendants = conn
    .all(
      `WITH RECURSIVE down(id, type, note, depth) AS (
         SELECT src_id, type, note, 1 FROM task_links WHERE dst_id = :id
         UNION ALL
         SELECT l.src_id, l.type, l.note, down.depth + 1
           FROM task_links l JOIN down ON l.dst_id = down.id
       )
       SELECT down.id, down.type, down.note, down.depth, t.seq
         FROM down JOIN tasks t ON t.id = down.id
        ORDER BY down.depth, t.seq`,
      { id }
    )
    .map((r) => ({ ...r, id: Number(r.id), seq: Number(r.seq), depth: Number(r.depth) }));
  return { ancestors, descendants };
}

