// 组合 localtask 主题与独立 timegoal 的显示模型。
//
// 只为视图准备一行一个目录；存储仍各自独立。保留 localtask 的原有顺序（全局池
// 永远最前）；只有 timegoal 的目录按 goal 的接口顺序追加，且同一 key 只出现一次。
//
// 本文件是**纯前端视图模型**，没有任何后端消费方——原先长在 modules/localtask/ 下，
// 被迫在前端目录之外维护，还得靠注释解释「别 import service.js」。现在归位到前端。
// 与后端的共同约定只有 `__GLOBAL__` 这一个字符串（见 localtask service 的 GLOBAL_KEY），
// 由 tests/unit/registry.test.mjs 的边界断言与 shared/ 层共同守住。

// 全局任务池（共享池）的固定标识 —— 与 localtask service 的 GLOBAL_KEY 一致。
export const GLOBAL_KEY = '__GLOBAL__';
export const GLOBAL_NAME = '全局任务';

// 全局池占位主题：全局池空着的时候，store 里**没有**这个主题（它只在真的投过
// 任务之后才存在），于是看板上就没有"全局任务"这一行 —— 用户想往全局池里加
// **第一条**任务时找不到入口（"全局任务队列里没有任务，全局任务就无法添加"就是这个坑）。
// 这个壳只在视图层造，不写 store：真投了第一条，store 里自然会有真的全局主题。
export function globalPlaceholderTopic() {
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
export function withGlobalRow(rows) {
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
export function splitQueueTasks(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  return {
    pending: list.filter((t) => t.status !== 'consumed' && t.status !== 'archived' && !t.deletedAt && !t.migratedTo),
    consumed: list.filter((t) => t.status === 'consumed' && !t.deletedAt).slice().reverse(),
    // 归档（#59）：被新任务取代的旧任务——终态留档，不再算进行中
    archived: list.filter((t) => t.status === 'archived' && !t.deletedAt).slice().reverse(),
    deleted: list.filter((t) => !!t.deletedAt).slice().reverse(),
    // 迁出记录（tombstone）：原条目留在队列里但已不算待领取，看板渲染成
    // 虚线灰卡「已迁移 → …」，可跳转/移除/撤销。保持队列原序（正序）。
    migrated: list.filter((t) => !!t.migratedTo && !t.deletedAt && t.status !== 'consumed'),
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
export function sortTasksForDisplay(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const pending = [];
  const consumed = [];
  const archived = [];
  const migrated = [];
  const deleted = [];
  for (const t of list) {
    if (t.deletedAt) deleted.push(t);
    else if (t.status === 'consumed') consumed.push(t);
    else if (t.status === 'archived') archived.push(t);
    else if (t.migratedTo) migrated.push(t);
    else pending.push(t);
  }
  // 归档沉在历史区（与迁出记录同层），删除记录垫底
  return [...pending, ...consumed.reverse(), ...migrated, ...archived.reverse(), ...deleted.reverse()];
}

export function mergeDirectoryRows(topics = [], goals = []) {  const rows = [];
  const byKey = new Map();

  for (const topic of topics) {
    const goal = goals.find((item) => item.key === topic.key) || null;
    const row = {
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
    if (byKey.has(goal.key)) {
      byKey.get(goal.key).goal = goal;
      continue;
    }
    const row = {
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
