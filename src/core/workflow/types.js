// workflow 契约（#34 阶段 0）—— 冻结类型，尚未接线到 localtask / tasktool。
//
// 对照参考方案（Node+TS DAG 动态工作流）在 nx-kv 上的映射：
//   workflowId     → 主题 key（cwd 归一化 / repos key；全局 '__GLOBAL__'）
//   submit(init)   → localtask add / tasktool submitTask（只入队，不构造全图）
//   get(id,node?)  → tasktool get / wait（AsyncIterable ≈ 单次或 waitgoal 长轮询）
//   Node           → localtask 一条任务（id 数字；状态用 status+completedAt）
//   Edge / blockBy → task.blockBy[] + task.blocksFollowing（闸门）
//   blockgoal      → scope=control；onSchedule 决定后继是否 ready（见 localtask/dag.js）
//   waitgoal       → scope=node；onGet = getLoop 开启后的阻塞窗口
//   timegoal       → scope=workflow|node；目录级 timegoal / 任务级 taskgoal
//
// 硬约束（与参考一致，落地时不得破坏）：
//   1. 对外稳定门面只有 submit / get（CLI/HTTP 名可别名，语义不变）
//   2. 调用方无感内部 DAG / goal 变更
//   3. goal 是插件族：block=调度侧，wait/time=消费侧
//   4. 单向依赖、无环；唯一写快照入口 = DagMutator（待抽，现散落在 localtask/service）
//   5. 快照原子覆盖，不做增量 patch 存储
//   6. PluginContext 只读；插件不持可变状态
//
// 工程约束（相对参考方案的刻意偏离）：
//   - 仓库保持 JS ESM + JSDoc，不上平行 TypeScript 引擎
//   - 契约落在 core/；业务仍在 modules/localtask + modules/tasktool
//   - 存储沿用本机 JSON 主题快照；RedisAdapter 属阶段 6，不挡主线
//   - 目标目录规范见同目录 layout.js（禁止平行 src/{facade,store,mutator,…}）

/** @typedef {'pending'|'ready'|'running'|'success'|'failed'} NodeState */
/** @typedef {'active'|'completed'|'failed'} WorkflowState */
/** @typedef {'workflow'|'node'|'control'} GoalScope */

/**
 * @typedef {object} PluginSpec
 * @property {string} name          blockgoal | waitgoal | timegoal | …
 * @property {GoalScope} scope
 * @property {Record<string, unknown>} [config]
 */

/**
 * @typedef {object} WfNode
 * @property {string|number} id
 * @property {'task'|'control'} kind
 * @property {NodeState} state
 * @property {PluginSpec[]} [plugins]
 * @property {unknown} [payload]    业务正文外置时可只留引用
 */

/**
 * @typedef {object} WfEdge
 * @property {string|number} from
 * @property {string|number} to
 */

/**
 * @typedef {object} WorkflowSnapshot
 * @property {string} workflowId           主题 key
 * @property {WorkflowState} state
 * @property {WfNode[]} nodes
 * @property {WfEdge[]} edges
 * @property {PluginSpec[]} [workflowPlugins]
 * @property {number} revision             CAS / 防写撕裂
 * @property {string} [updatedAt]
 */

/**
 * @typedef {object} InitMeta
 * @property {string} [cwd]
 * @property {string} [key]
 * @property {string} [text]               首条任务可选；空 submit = 只建主题
 * @property {Record<string, unknown>} [meta]
 */

/**
 * 插件只读上下文（禁止写快照；变更必须走 DagMutator）。
 * @typedef {object} PluginContext
 * @property {Readonly<WorkflowSnapshot>} snapshot
 * @property {string|number} [nodeId]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} BasePlugin
 * @property {string} name
 * @property {GoalScope} scope
 * @property {(ctx: PluginContext, config: Record<string, unknown>) => void} [onBind]
 * @property {(ctx: PluginContext) => void} [onSchedule]
 * @property {(ctx: PluginContext) => AsyncGenerator<unknown>} [onGet]
 */

/** @type {readonly NodeState[]} */
export const NODE_STATES = Object.freeze([
  'pending',
  'ready',
  'running',
  'success',
  'failed',
]);

/** @type {readonly WorkflowState[]} */
export const WORKFLOW_STATES = Object.freeze(['active', 'completed', 'failed']);

/** @type {readonly GoalScope[]} */
export const GOAL_SCOPES = Object.freeze(['workflow', 'node', 'control']);

/** 内置 goal 名（注册表校验用） */
export const BUILTIN_GOALS = Object.freeze({
  blockgoal: 'blockgoal',
  waitgoal: 'waitgoal',
  timegoal: 'timegoal',
});

/**
 * 这个节点是不是「闸门」（控制屏障）——唯一的判定口径，全系统共用
 * （曾散落 5 处且字段漂移：有的只认 blockgoal 名、有的连 scope==='control' 一起认）。
 * 并集口径：kind=control，或绑了 blockgoal，或绑了任意 control-scope 插件。
 * @param {WfNode} node
 * @returns {boolean}
 */
export function isGateNode(node) {
  if (!node) return false;
  if (node.kind === 'control') return true;
  return (node.plugins || []).some(
    (p) => p.name === BUILTIN_GOALS.blockgoal || p.scope === 'control'
  );
}

/**
 * 把现有 localtask 任务行投影成契约节点（只读适配，不改存盘形状）。
 * @param {object} task
 * @returns {WfNode}
 */
export function taskToNode(task) {
  const completed = !!task?.completedAt;
  const claimed = task?.status === 'claimed';
  // 终态（done / cancelled）不会再动：依赖它的人不该永远被挡着（#59）。
  // 词表见 src/shared/task-status.js（core 层不得 import shared，故内联）。
  const terminal = task?.status === 'done' || task?.status === 'cancelled';
  /** @type {NodeState} */
  let state = 'pending';
  if (completed || terminal) state = 'success';
  else if (claimed) state = 'running';
  else if (task?.ready === true) state = 'ready';

  /** @type {PluginSpec[]} */
  const plugins = [];
  if (task?.blocksFollowing) {
    plugins.push({ name: BUILTIN_GOALS.blockgoal, scope: 'control', config: {} });
  }
  if (task?.timegoal) {
    plugins.push({
      name: BUILTIN_GOALS.timegoal,
      scope: 'node',
      config: { ...(typeof task.timegoal === 'object' ? task.timegoal : {}) },
    });
  }

  return {
    id: task?.id,
    kind: task?.blocksFollowing ? 'control' : 'task',
    state,
    plugins,
    payload: { textRef: true },
  };
}

/**
 * 从任务列表推隐式边：显式 blockBy + 闸门 blocksFollowing 的「挡后续」。
 * @param {object[]} tasks
 * @returns {WfEdge[]}
 */
export const edgesFromTasks = (tasks = []) => {
  /** @type {WfEdge[]} */
  const edges = [];
  const alive = (tasks || []).filter((t) => t && !t.deletedAt && !t.migratedTo);
  for (const t of alive) {
    for (const dep of Array.isArray(t.blockBy) ? t.blockBy : []) {
      // 引擎快照只认本队列数字边；跨队列 "key:id" 留给 get/ready 解析
      const n = Number(dep);
      if (!Number.isFinite(n) || n <= 0 || String(dep).includes(':')) continue;
      edges.push({ from: n, to: t.id });
    }
  }
  for (let i = 0; i < alive.length; i += 1) {
    const gate = alive[i];
    if (!gate.blocksFollowing) continue;
    for (let j = i + 1; j < alive.length; j += 1) {
      edges.push({ from: gate.id, to: alive[j].id });
    }
  }
  return edges;
};
