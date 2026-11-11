/** workflow EventBus 事件名（冻结） */
export const EVENTS = Object.freeze({
  WORKFLOW_CREATED: 'workflow:created',
  DAG_MUTATED: 'dag:mutated',
  NODE_STATE_CHANGED: 'node:stateChanged',
  GOAL_BOUND: 'goal:bound',
  GOAL_UNBOUND: 'goal:unbound',
  GOAL_CONFIG_UPDATED: 'goal:configUpdated',
  WORKFLOW_COMPLETED: 'workflow:completed',
});
