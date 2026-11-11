// Workflow / Node / Plugin 生命周期（冻结）。插件只挂钩子，不拥有可变状态。
//
// ┌─ Workflow ──────────────────────────────────────────────┐
// │  created ──▶ active ──▶ completed | failed              │
// │     │           │                                       │
// │     │           ├─ Mutator 改拓扑/goal → dag:mutated     │
// │     │           ├─ Scheduler onSchedule（永不 onGet）     │
// │     │           └─ Facade get → onGet 消费流             │
// └─────────────────────────────────────────────────────────┘
//
// ┌─ Node ──────────────────────────────────────────────────┐
// │  pending ──▶ ready ──▶ running ──▶ success | failed     │
// │     ▲          │          │                             │
// │     └─ 屏障加回  │          └─ done / worker              │
// │                └─ Scheduler driveReadyStates            │
// └─────────────────────────────────────────────────────────┘
//
// ┌─ Plugin 实例钩子（按绑定点注入）──────────────────────────┐
// │  onBind        Mutator.bindPlugin 时：校验并规范化 config │
// │  onSchedule    Scheduler 轮：仅 scope=control（blockgoal）│
// │  onGet         Facade get：scope=workflow|node 消费流     │
// │  onUnbind      Mutator.unbindPlugin 时：可选清理（无状态） │
// │                                                         │
// │  叠加：workflow.timegoal 包裹 node.waitgoal               │
// │  约束：调度链禁止调 onGet；消费链禁止写快照（只读 ctx）     │
// └─────────────────────────────────────────────────────────┘

export type WorkflowPhase = 'created' | 'active' | 'completed' | 'failed';
export type NodePhase = 'pending' | 'ready' | 'running' | 'success' | 'failed';
export type PluginHook = 'onBind' | 'onSchedule' | 'onGet' | 'onUnbind';

export const WORKFLOW_PHASES = Object.freeze<WorkflowPhase[]>([
  'created',
  'active',
  'completed',
  'failed',
]);

export const NODE_PHASES = Object.freeze<NodePhase[]>([
  'pending',
  'ready',
  'running',
  'success',
  'failed',
]);

/** 插件可实现的钩子；未实现视为空操作 */
export const PLUGIN_HOOKS = Object.freeze<PluginHook[]>(['onBind', 'onSchedule', 'onGet', 'onUnbind']);

/**
 * 哪条执行链会调用哪个钩子。
 */
export const HOOK_CHAINS: Readonly<Record<'schedule' | 'get' | 'mutate', readonly PluginHook[]>> = Object.freeze({
  mutate: Object.freeze<PluginHook[]>(['onBind', 'onUnbind']),
  schedule: Object.freeze<PluginHook[]>(['onSchedule']),
  get: Object.freeze<PluginHook[]>(['onGet']),
});
