// 任务状态词表：**全链路唯一权威**（库 / API / CLI / 前端 / 测试断言）。
//
// 为什么收成一个同构纯函数模块（src/shared/ 允许前端与后端同时 import）：
// 状态判断以前散在 5 处各写一份，其中最要命的一份是「排除法」——
//
//     isPending = status !== 'consumed' && status !== 'archived' && !deletedAt
//
// 排除法的语义是「**我不认识的一律当待领取**」。于是任何新状态（或迁移漏掉的一条）
// 都会立刻变成可领取任务：agent 会把一条已完成/已取消的活儿再干一遍，**而且不报错**。
// 改成**正判定**（`status === 'pending'`）以后，不认识的词一律不算待领取——
// 宁可少派一条（人看得见），也不多派一条（没人看得见）。
//
// 四个词与旧词的关系（旧词只允许出现在迁移器里，见 core/db/import-json）：
//   旧 pending        → pending
//   旧 consumed(未交付)→ claimed   ← 已领取、还没交付
//   旧 consumed(已交付)→ done      ← 交付完成（旧数据用「有 roundSummary」表示）
//   旧 archived       → done / cancelled（旧数据用「有 roundSummary」区分）
//
// 本模块**零依赖、零 Node API**：前端与后端加载同一份代码，判断不可能分叉。
// （core/ 层不得 import shared/ —— 见 eslint 分层规则；core/workflow 里保留
//  少量内联字面量并在注释里指回这里。）

/** 四个合法状态。 */
export const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const);

/** 全部合法状态（顺序即面板展示顺序：待领取 → 已领取 → 已交付 → 已取消）。 */
export const TASK_STATUSES: readonly string[] = Object.freeze([
  TASK_STATUS.PENDING,
  TASK_STATUS.CLAIMED,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELLED,
]);

/** 状态的中文标签（CLI / 面板共用一份，避免两处措辞不同）。 */
export const STATUS_TAG: Record<string, string> = Object.freeze({
  pending: '待领取',
  claimed: '已领取',
  done: '已交付',
  cancelled: '已取消',
});

/** 状态是否合法。 */
export function isTaskStatus(v: unknown): boolean {
  return TASK_STATUSES.includes(String(v));
}

/** 状态标签；不认识的词原样返回（诊断时看得见真值，而不是被 "待领取" 盖住）。 */
export function statusTag(status: unknown): string {
  return STATUS_TAG[String(status)] || String(status ?? '');
}

// ─── 行级谓词 ─────────────────────────────────────────────────────────
//
// 入参是**任务行**（JSON 形态：status / deletedAt / migratedTo）。
// T03 换库后行字段会变成 deleted_at / migrated_to，届时只改这里一处。

/** 任务行的最小形状（shared 层不关心其余字段，用结构性子集收窄）。 */
export interface TaskRowLike {
  status?: string | null;
  deletedAt?: string | null;
  migratedTo?: string | null;
}

function isLive(t?: TaskRowLike | null): boolean {
  return !!t && !t.deletedAt && !t.migratedTo;
}

/**
 * 待领取：**正判定** + 必须活着。
 *
 * 软删与迁出都要挡（否则删掉的任务仍会被派发 —— 见 board-view 的历史注释）。
 */
export function isPending(t?: TaskRowLike | null): boolean {
  return isLive(t) && t?.status === TASK_STATUS.PENDING;
}

/** 已领取（在干、还没交付）。 */
export function isClaimed(t?: TaskRowLike | null): boolean {
  return isLive(t) && t?.status === TASK_STATUS.CLAIMED;
}

/** 已交付（终态，不会再动）。 */
export function isDone(t?: TaskRowLike | null): boolean {
  return isLive(t) && t?.status === TASK_STATUS.DONE;
}

/** 已取消（终态，不会再动）。 */
export function isCancelled(t?: TaskRowLike | null): boolean {
  return isLive(t) && t?.status === TASK_STATUS.CANCELLED;
}

/**
 * 终态：done / cancelled。
 * 依赖闸门用它判「这一条不会再动了，别永久挡住后面的人」（旧口径把 archived 也算终态）。
 */
export function isTerminal(t?: TaskRowLike | null): boolean {
  return isLive(t) && (t?.status === TASK_STATUS.DONE || t?.status === TASK_STATUS.CANCELLED);
}

/** 活跃（还可以继续推进）：pending / claimed。 */
export function isOpenTask(t?: TaskRowLike | null): boolean {
  return isLive(t) && (t?.status === TASK_STATUS.PENDING || t?.status === TASK_STATUS.CLAIMED);
}
