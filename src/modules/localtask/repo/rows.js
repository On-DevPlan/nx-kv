// 行形状适配：SQLite 行（epoch ms + ext JSON）⇄ 视图/引擎用的任务对象（JSON 形态）。
//
// 为什么需要这一层：T03 只换存储不动行为。视图（normalizeTask / topicToSnapshot）与
// 约 20 个测试文件断言的都是 JSON 形态的对象（字符串时间戳、id、roundSummary…），
// 让 repo 统一在边界上做行↔对象转换，业务代码与断言一行不用改。
//
// 字段映射（旧 JSON 字段 → 列），T02 留的过渡别名（doneAt/feedback）在这里成为唯一名：
//   id            → tasks.seq
//   text          → tasks.body
//   status        → tasks.status          pending / claimed / done / cancelled
//   createdAt     → tasks.created_at      "YYYY-MM-DD HH:mm:ss"（本地）↔ epoch ms
//   consumedAt    → tasks.claimed_at
//   completedAt   → tasks.done_at
//   roundSummary  → tasks.feedback
//   deletedAt     → tasks.deleted_at
//   from          → tasks.from_src
//   blocksFollowing → tasks.blocks_following
//   reopenCount   → tasks.round - 1       （round = 重开次数 + 1，schema 语义）
//   blockBy 本地数字 → task_deps 行；"key:id" 跨队列引用 → ext.ext_deps_foreign
//   其余低频字段（history / forkOf / timegoal / trashIndex / claimedFrom…）→ tasks.ext
import { msToStamp, parseStampMs, nowMs } from '../../../core/db/time.js';

/** ext 的键名集中在这里（散着写迟早拼错一个）。 */
export const EXT = Object.freeze({
  PICKUP_SEC: 'ext_pickup_sec',
  TRASH_INDEX: 'ext_trash_index',
  TIMEGOAL: 'ext_timegoal',
  SUPERSEDED_BY: 'ext_superseded_by',
  ARCHIVED_AT: 'ext_archived_at',
  ARCHIVED_REASON: 'ext_archived_reason',
  CLAIMED_FROM: 'ext_claimed_from',
  CLAIMED_BY: 'ext_claimed_by',
  CLAIMED_BY_NAME: 'ext_claimed_by_name',
  DEPS_FOREIGN: 'ext_deps_foreign',
  MIGRATED_TO: 'ext_migrated_to',
  MOVE_FROM: 'ext_move_from',
  HISTORY: 'ext_history',
});

/** topics.ext 的键名。 */
export const TOPIC_EXT = Object.freeze({
  MANUAL: 'ext_manual',
  SUBMIT_SUMMARY: 'ext_submit_summary',
  WORKFLOW_STATE: 'ext_workflow_state',
  WORKFLOW_PLUGINS: 'ext_workflow_plugins',
  TASK_ORDER: 'ext_task_order',
  GLOBAL: 'ext_global',
  LAST_SUMMARY: 'ext_last_summary',
});

export function parseExt(raw) {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const jsonText = (v) => JSON.stringify(v === undefined || v === null ? null : v);

/** 毫秒 → 视图用的本地时间串；空/非法 → 空串（JSON 时代的"没发生过"就是这个形状）。 */
export const stampOf = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? msToStamp(ms) : '');
/** 视图串 → 毫秒；空/非法 → null（列可空）。 */
export const msOf = (s) => {
  const n = parseStampMs(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * DB 任务行 → JSON 形态任务对象（store 里那条"原始行"的形状）。
 * @param {object} row repo/tasks.js 查出的行（已含 deps / ext 解析）
 */
export function rowToTask(row) {
  // ext 既可能是 JSON 字符串（raw 行）也可能已是对象（调用方预解析）—— 两种都接
  const ext = typeof row.ext === 'string' ? parseExt(row.ext) : row.ext || {};
  const localDeps = Array.isArray(row.depsLocal) ? row.depsLocal.map(Number) : [];
  const foreignDeps = Array.isArray(ext[EXT.DEPS_FOREIGN]) ? ext[EXT.DEPS_FOREIGN].map(String) : [];
  return {
    id: Number(row.seq),
    text: String(row.body ?? ''),
    status: String(row.status ?? 'pending'),
    createdAt: stampOf(row.createdAtMs),
    consumedAt: stampOf(row.claimedAtMs),
    completedAt: stampOf(row.doneAtMs),
    roundSummary: String(row.feedback ?? ''),
    deletedAt: stampOf(row.deletedAtMs),
    from: String(row.fromSrc ?? ''),
    blocksFollowing: !!row.blocksFollowing,
    blockBy: [...localDeps, ...foreignDeps],
    timegoal: ext[EXT.TIMEGOAL] || null,
    trashIndex: ext[EXT.TRASH_INDEX] ?? undefined,
    pickupSec: ext[EXT.PICKUP_SEC] ?? undefined,
    supersededBy: ext[EXT.SUPERSEDED_BY] ?? null,
    archivedAt: String(ext[EXT.ARCHIVED_AT] ?? ''),
    archivedReason: String(ext[EXT.ARCHIVED_REASON] ?? ''),
    claimedFrom: String(ext[EXT.CLAIMED_FROM] ?? ''),
    claimedBy: String(ext[EXT.CLAIMED_BY] ?? ''),
    claimedByName: String(ext[EXT.CLAIMED_BY_NAME] ?? ''),
    reopenCount: Math.max(0, Number(row.round ?? 1) - 1),
    // 派生子任务数（#144）：>0 = 链上已有后续轮次，反馈入口只在链尖显示
    childCount: Number(row.childCount ?? 0),
    // 派生的「下一轮」数（#172）：reopen 边数——>0 = 本条已被下一轮取代（不是链尖）。
    // comment / feedback 边（旁支新活）不计入。
    childRoundCount: Number(row.childRoundCount ?? 0),
    // 迁出 tombstone（本机 → 云端）：原条目留在队列里只作记录，不算待领取
    migratedTo: ext[EXT.MIGRATED_TO] || null,
    moveFrom: ext[EXT.MOVE_FROM] || null,
    updatedAtMs: Number(row.updatedAtMs ?? 0),
    createdAtMs: Number(row.createdAtMs ?? 0),
  };
}

/**
 * 拆一个 JSON 任务对象的字段 → 列值 / ext / 依赖。
 * 供 insert 与 update 共用（一处口径，两边不会漂）。
 */
export function splitTaskFields(t) {
  const ext = {};
  const put = (k, v) => {
    if (v !== undefined) ext[k] = v;
  };
  put(EXT.PICKUP_SEC, t.pickupSec);
  put(EXT.TRASH_INDEX, t.trashIndex);
  if (t.timegoal !== undefined) put(EXT.TIMEGOAL, t.timegoal || null);
  if (t.history !== undefined) put(EXT.HISTORY, Array.isArray(t.history) ? t.history : []);
  put(EXT.SUPERSEDED_BY, t.supersededBy);
  put(EXT.ARCHIVED_AT, t.archivedAt);
  put(EXT.ARCHIVED_REASON, t.archivedReason);
  put(EXT.CLAIMED_FROM, t.claimedFrom);
  put(EXT.CLAIMED_BY, t.claimedBy);
  put(EXT.CLAIMED_BY_NAME, t.claimedByName);
  if (t.migratedTo !== undefined) put(EXT.MIGRATED_TO, t.migratedTo || null);
  if (t.moveFrom !== undefined) put(EXT.MOVE_FROM, t.moveFrom || null);

  const all = Array.isArray(t.blockBy) ? t.blockBy : [];
  const depsLocal = all.filter((d) => !String(d).includes(':')).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const depsForeign = all.filter((d) => String(d).includes(':')).map(String);
  if (t.blockBy !== undefined) ext[EXT.DEPS_FOREIGN] = depsForeign;

  return {
    columns: {
      body: String(t.text ?? ''),
      status: String(t.status ?? 'pending'),
      feedback: t.roundSummary !== undefined ? String(t.roundSummary ?? '') : undefined,
      claimedAtMs: t.consumedAt !== undefined ? msOf(t.consumedAt) : undefined,
      doneAtMs: t.completedAt !== undefined ? msOf(t.completedAt) : undefined,
      deletedAtMs: t.deletedAt !== undefined ? msOf(t.deletedAt) : undefined,
      fromSrc: t.from !== undefined ? String(t.from ?? '') : undefined,
      blocksFollowing: t.blocksFollowing !== undefined ? (t.blocksFollowing ? 1 : 0) : undefined,
      // round 显式优先（派生 reopen：新.round = 父.round + 1，不走 reopenCount 换算）
      round: t.round !== undefined ? Number(t.round) : t.reopenCount !== undefined ? Number(t.reopenCount) + 1 : undefined,
      createdAtMs: t.createdAt !== undefined ? msOf(t.createdAt) : undefined,
    },
    ext,
    depsLocal,
    depsForeign,
  };
}

/** 现在的毫秒（测试可以打桩 core/db/time 的 nowMs；这里转发保持单一入口）。 */
export const now = nowMs;
