// 组合 localtask 主题与独立 timegoal 的显示模型。
//
// 只为视图准备一行一个目录；存储仍各自独立。保留 localtask 的原有顺序（全局池
// 永远最前）；只有 timegoal 的目录按 goal 的接口顺序追加，且同一 key 只出现一次。
//
// 本文件是**纯前端视图模型**，没有任何后端消费方——原先长在 modules/localtask/ 下，
// 被迫在前端目录之外维护，还得靠注释解释「别 import service.js」。现在归位到前端。
// 与后端的共同约定只有 `__GLOBAL__` 这一个字符串（见 localtask service 的 GLOBAL_KEY），
// 由 tests/unit/registry.test.mjs 的边界断言与 shared/ 层共同守住。

// 任务状态词表与谓词：前后端共用同一份实现（src/shared/task-status.js）。
// 以前这里抄了一份「排除法」的 isPendingRow，与后端各写一遍迟早分叉。
import { isPending } from '../../../../shared/task-status.js';
import type { BoardRow, LocalTask, LocalTopic } from '../../types.js';

// 全局任务池（共享池）的固定标识 —— 与 localtask service 的 GLOBAL_KEY 一致。
export const GLOBAL_KEY = '__GLOBAL__';
export const GLOBAL_NAME = '全局任务';

/** 时间目标（/api/timegoals 的行；合并目录行时只读 key/cwd/name）。 */
export interface DirectoryGoal {
  key: string;
  cwd?: string;
  name?: string;
  [k: string]: any;
}

/** 合并后的目录行（localTask 主题 + 可选 timegoal；侧栏/看板共用）。 */
export interface DirectoryRow {
  key: string;
  cwd: string;
  name: string;
  topic: LocalTopic | null;
  goal: DirectoryGoal | null;
  isGlobal: boolean;
  placeholder?: boolean;
  [k: string]: any;
}

/** splitQueueTasks 的六个桶（与任务状态词表一一对应）。 */
export interface QueueBuckets {
  pending: LocalTask[];
  claimed: LocalTask[];
  done: LocalTask[];
  cancelled: LocalTask[];
  deleted: LocalTask[];
  migrated: LocalTask[];
}

/** findGroupTask 的命中面（找不到的字段为 null）。 */
export interface GroupTaskHit {
  board: BoardRow | null;
  topic: LocalTopic | null;
  taskRow: LocalTask | null;
}

// 全局池占位主题：全局池空着的时候，store 里**没有**这个主题（它只在真的投过
// 任务之后才存在），于是看板上就没有"全局任务"这一行 —— 用户想往全局池里加
// **第一条**任务时找不到入口（"全局任务队列里没有任务，全局任务就无法添加"就是这个坑）。
// 这个壳只在视图层造，不写 store：真投了第一条，store 里自然会有真的全局主题。
export function globalPlaceholderTopic(): LocalTopic {
  return {
    key: GLOBAL_KEY,
    cwd: '',
    name: GLOBAL_NAME,
    summary: '',
    waiting: false,
    staleWaiting: false,
    waitingUntil: '',
    waitingUntilMs: 0,
    waitingSince: '',
    cancelRequested: false,
    isGlobal: true,
    manual: false,
    createdAt: '',
    updatedAt: '',
    pending: 0,
    total: 0,
    tasks: [],
  };
}

// 看板上补一行全局池：真主题已在则原样返回（不重复），否则补一个占位行。
export function withGlobalRow(rows: DirectoryRow[]): DirectoryRow[] {
  if (rows.some((r) => r.isGlobal)) return rows;
  return [
    {
      key: GLOBAL_KEY,
      cwd: '',
      name: GLOBAL_NAME,
      topic: null,
      goal: null,
      isGlobal: true,
      placeholder: true,
    },
    ...rows,
  ];
}

/**
 * 把一个主题的任务拆成三段：待领取 / 已领取 / 已删除。
 *
 * ⚠️ **软删除的任务必须从待领取与已领取里排除**。
 * 以前视图只按 status 过滤，于是删掉的任务仍然留在「待领取」表里：用户点了删除、
 * 行纹丝不动（deletedAt 又被设成同一个值），再点删除也没反应 —— 表现就是
 * 「这个任务我删不掉」。服务端派发本来就按 `!deletedAt` 过滤（不会把删掉的
 * 任务发给 agent），所以**只有面板这一层是错的**，两边口径必须一致。
 *
 * 已领取是**倒序**（新的在上面），待领取是**正序**（= 领取优先级，数组原序）。
 */
export function splitQueueTasks(tasks: LocalTask[] = []): QueueBuckets {
  const list = Array.isArray(tasks) ? tasks : [];
  return {
    // 四桶与任务状态词表一一对应（src/shared/task-status.js）：
    // pending 待领取 / claimed 已领取（在干）/ done 已交付 / cancelled 已取消（终态留档）
    pending: list.filter((t) => t.status === 'pending' && !t.deletedAt && !t.migratedTo),
    claimed: list.filter((t) => t.status === 'claimed' && !t.deletedAt).slice().reverse(),
    done: list.filter((t) => t.status === 'done' && !t.deletedAt).slice().reverse(),
    cancelled: list.filter((t) => t.status === 'cancelled' && !t.deletedAt).slice().reverse(),
    deleted: list.filter((t) => !!t.deletedAt).slice().reverse(),
    // 迁出记录（tombstone）：原条目留在队列里但已不算待领取，看板渲染成
    // 虚线灰卡「已迁移 → …」，可跳转/移除/撤销。保持队列原序（正序）。
    migrated: list.filter((t) => !!t.migratedTo && !t.deletedAt),
  };
}

/**
 * 任务在**列表视图**里的排序：未完成（待领取）优先，其余按桶依次下沉。
 *
 * 为什么要有这一份（2026-11-03 反馈「优先显示没有完成的任务」）：
 * 队列数组是**追加序**（谁先提交谁在前），于是一条新任务会被几十条历史
 * 埋在下面——用户加完活儿在列表里找不到它（「追加任务显示」正是这个体感）。
 * 所以**显示序**与**队列序**分开：显示时把待领取提到最前，其余沉到后面。
 *
 * 桶内顺序沿用 splitQueueTasks 的口径：
 *   - 待领取：队列原序（= 领取优先级，不能乱）
 *   - 已领取：倒序（新的在上面）
 *   - 已迁出 / 已删除：迁出保原序、删除倒序（同 splitQueueTasks）
 *
 * 纯函数、无副作用（不改传入数组）。
 */
export function sortTasksForDisplay(tasks: LocalTask[] = []): LocalTask[] {
  const list = Array.isArray(tasks) ? tasks : [];
  const pending: LocalTask[] = [];
  const claimed: LocalTask[] = [];
  const done: LocalTask[] = [];
  const cancelled: LocalTask[] = [];
  const migrated: LocalTask[] = [];
  const deleted: LocalTask[] = [];
  for (const t of list) {
    if (t.deletedAt) deleted.push(t);
    else if (t.status === 'claimed') claimed.push(t);
    else if (t.status === 'done') done.push(t);
    else if (t.status === 'cancelled') cancelled.push(t);
    else if (t.migratedTo) migrated.push(t);
    else pending.push(t);
  }
  // 终态（已交付 / 已取消）沉在历史区（与迁出记录同层），删除记录垫底
  return [
    ...pending,
    ...claimed.reverse(),
    ...migrated,
    ...done.reverse(),
    ...cancelled.reverse(),
    ...deleted.reverse(),
  ];
}

// ─── 两种走向（任务 #85）─────────────────────────────────────────────
// 本产品有两种仓库归属：**项目**与**项目组**。组任务（正文 frontmatter 带 board，
// 服务端已在行上标好 boardMark）物理上落在项目队列里（领取流程按目录领），但
// **走向**属于组：项目侧的列表与计数剔除，组页按 board 归属认领。
// 判据只读行上的标注，不在这里重复解析正文。

/** 是否组任务（frontmatter.board 存在；服务端 normalizeTask 负责标注） */
export function isGroupTask(t?: LocalTask | null): boolean {
  return !!(t && t.boardMark);
}

/**
 * 服务端 isPending（shared/task-status.js）的前端同款。
 * 现在直接调同一份实现 —— 以前前后端各写一遍排除法，两边迟早分叉。
 */
export function isPendingRow(t: LocalTask): boolean {
  return isPending(t);
}

/** 项目走向视图的任务清单：组任务剔除、软删除不进（与各列表页的基底过滤同口径） */
export function projectTasks(tasks: LocalTask[] = []): LocalTask[] {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.filter((t) => !t.deletedAt && !isGroupTask(t));
}

/** 项目走向的待领取数 */
export function projectPending(tasks: LocalTask[] = []): number {
  return projectTasks(tasks).filter(isPendingRow).length;
}

/** 组的三种身份（id / key / name 都认——面板创建写 id，手写 frontmatter 可能给 key/name） */
export function boardMatchIds(board?: BoardRow | null): string[] {
  return [board && board.id, board && board.key, board && board.name].filter(Boolean).map(String);
}

/** 任务是否指向这个组（ids 数组或 board 对象都收）；与组页「本组任务」同口径 */
export function taskInBoard(t: LocalTask | null | undefined, idsOrBoard?: string[] | BoardRow | null): boolean {
  if (!isGroupTask(t) || !t) return false;
  const ids = Array.isArray(idsOrBoard) ? idsOrBoard : boardMatchIds(idsOrBoard);
  return ids.includes(String(t.boardMark));
}

/**
 * 组路由的任务寻址（任务 #86）：组任务详情路由是 `#/group/<boardId>?task=N`，
 * route.key 是**看板 id**，不是队列 key——这条任务物理上落在哪个成员队列，
 * 要在成员队列里搜出来。
 *
 * 口径：只在组成员的队列里找（board.repos 的 key）；同一任务号在不同项目里
 * 可能撞号，所以**优先**取 boardMark 指向本组的候选，找不到再退第一个命中
 * （手工改归属导致 boardMark 缺失/漂移时仍能打开）。找到返回
 * { board, topic, taskRow }，找不到对应字段为 null。纯函数。
 */
export function findGroupTask(
  rows: LocalTopic[] = [],
  boards: BoardRow[] = [],
  groupKey?: string,
  taskId?: string | number | null,
): GroupTaskHit {
  const board = (boards || []).find(
    (b) => b && (b.id === groupKey || b.key === groupKey || b.name === groupKey)
  ) || null;
  const out: GroupTaskHit = { board, topic: null, taskRow: null };
  if (!board || taskId == null || String(taskId) === '') return out;
  // 成员 key 是**仓库 key**（/api/boards 的 repos[].key），而队列行的 r.key 是
  // owner 哈希——两个键空间！全 app 的桥都是 r.repo.key（task.jsx boardCtx、
  // 组页 items 同款）；队列行没有 repo 时退 r.key 兜底（旧数据形态）。
  const memberKeys = new Set(
    ((board.repos || []) as Array<Record<string, any>>).map((m) => m && (m.key || m.id)).filter(Boolean),
  );
  // 行侧候选：repo.key（主桥）、repo.id（成员登记只有 id 时的兜底）、r.key（旧形态）
  const rowKeyOf = (r: LocalTopic): any[] => {
    const repo = r && r.repo;
    return [repo && repo.key, repo && repo.id, r && r.key].filter(Boolean);
  };
  const ids = boardMatchIds(board);
  for (const r of rows || []) {
    if (!r || r.isGlobal) continue;
    if (memberKeys.size && !rowKeyOf(r).some((k) => memberKeys.has(k))) continue;
    const hit = (r.tasks || []).find((t) => t && !t.deletedAt && String(t.id) === String(taskId));
    if (!hit) continue;
    if (!out.topic) {
      out.topic = r;
      out.taskRow = hit;
    }
    if (ids.includes(String(hit.boardMark || ''))) {
      out.topic = r;
      out.taskRow = hit;
      break;
    }
  }
  return out;
}

export function mergeDirectoryRows(topics: LocalTopic[] = [], goals: DirectoryGoal[] = []): DirectoryRow[] {
  const rows: DirectoryRow[] = [];
  const byKey = new Map<string, DirectoryRow>();

  for (const topic of topics) {
    const goal = goals.find((item) => item.key === topic.key) || null;
    const row: DirectoryRow = {
      key: topic.key,
      cwd: topic.cwd || goal?.cwd || '',
      name: topic.name || goal?.name || topic.cwd || goal?.cwd || '（未命名）',
      topic,
      goal,
      isGlobal: !!topic.isGlobal,
    };
    rows.push(row);
    byKey.set(row.key, row);
  }

  for (const goal of goals) {
    const existing = byKey.get(goal.key);
    if (existing) {
      existing.goal = goal;
      continue;
    }
    const row: DirectoryRow = {
      key: goal.key,
      cwd: goal.cwd || '',
      name: goal.name || goal.cwd || '（未命名）',
      topic: null,
      goal,
      isGlobal: false,
    };
    rows.push(row);
    byKey.set(row.key, row);
  }

  // 注册表的 topics 顺序本来就把全局主题置顶；保留该约定，同时为直接调用的
  // 使用方兜底（例如单测或以后复用 board selector 的其它视图）。
  rows.sort((a, b) => Number(b.isGlobal) - Number(a.isGlobal));
  return rows;
}
