// 任务（localtask）HTTP 收口：任务页模板（page/dir、page/group）与任务编辑器共用的那一组。
//
// 为什么在这层：#251 起目录页与组页共用同一套「行尾 / 批量」动作（components/task-panel/
// task-ops），两个页面都要能调同一组接口；接口定义留在某一页的 api.ts 里会让另一页
// 反向依赖页面目录。页面自己的 api.ts 保留各自专有的调用，并 re-export 这份公共面。
//
// 只搬调用不改语义：路径 / 方法 / body 与原 page/dir/api.ts 逐字一致。
// scope：主题定位二选一——{ cwd } 或 { key }（#190 起队列一律绑定目录，无全局池）。
import { api } from './client.js';

/** 主题定位：cwd（目录主题）或 key（含全局池）。 */
export type TaskScope = { cwd?: string; key?: string };

/** 变更类返回的公共形状：task=落地后的任务；key/moved/name=落点与归属迁移提示。 */
export interface TaskMutationResult {
  task?: { id?: number | string; text?: string };
  id?: number | string;
  key?: string;
  moved?: boolean;
  name?: string;
}

/** 批量操作返回：count=处理条数；skipped/missing=跳过 / 未找到的编号。 */
export interface TaskBulkResult {
  count?: number;
  skipped?: Array<number | string>;
  missing?: Array<number | string>;
  /** closeMany 专用：本轮收口里「原本已被领取」的编号（#184 面板提示用）。 */
  claimedClosed?: Array<number | string>;
}

/** 队列内调序（PATCH /api/localtasks/reorder；beforeId / afterId 二选一）。 */
export function reorderTask(
  body: TaskScope & { id: number; beforeId?: number | string; afterId?: number | string },
): Promise<unknown> {
  return api('/api/localtasks/reorder', { method: 'PATCH', body });
}

export interface PatchTaskItemBody extends TaskScope {
  id: number;
  text?: string;
  gate?: boolean;
  blockBy?: string | number[];
  duration?: string;
  clearGoal?: boolean;
  goalPrompt?: string;
  summary?: string;
  [k: string]: unknown;
}

/** 编辑单个本地任务（PATCH /api/localtasks/item；CLI localtask update 等价）。 */
export function patchTaskItem(body: PatchTaskItemBody): Promise<TaskMutationResult> {
  return api('/api/localtasks/item', { method: 'PATCH', body });
}

/**
 * 按查询串查单条任务（GET /api/localtasks/item?<q>）。
 * 找不到或出错返回 null（调用方以 null 判「没有这条」）。
 */
export function findTaskItem(query: string): Promise<any> {
  return api(`/api/localtasks/item?${query}`).catch(() => null);
}

export interface AddTaskBody extends TaskScope {
  global?: boolean;
  text: string;
  forkOf?: string;
  forkKind?: string;
  board?: string;
  project?: string;
  [k: string]: unknown;
}

/** 加任务（POST /api/localtasks；CLI localtask add 等价）。 */
export function addTask(body: AddTaskBody): Promise<any> {
  return api('/api/localtasks', { method: 'POST', body });
}

/**
 * #126：在 pending ↔ plan 之间切换一条任务（PATCH /api/localtasks/plan）。
 * plan 是不进队列的临时草稿，get/wait 都领不到；转回 pending 才重新排队。
 */
export function setPlanStatus(body: TaskScope & { id: number; to: 'plan' | 'pending' }): Promise<any> {
  return api('/api/localtasks/plan', { method: 'PATCH', body });
}

/** 重开 / 追加反馈（POST /api/localtasks/reopen；kind=reopen|comment）。 */
export function postReopen(body: Record<string, unknown>): Promise<TaskMutationResult> {
  return api('/api/localtasks/reopen', { method: 'POST', body });
}

/** 删除单个本地任务（DELETE /api/localtasks/item；purge=true 彻底删除）。 */
export function removeTaskItem(body: TaskScope & { id: number; purge?: boolean }): Promise<unknown> {
  return api('/api/localtasks/item', { method: 'DELETE', body });
}

/** 批量软删除（DELETE /api/localtasks/items）。 */
export function removeManyTasks(body: TaskScope & { ids: unknown[] }): Promise<TaskBulkResult> {
  return api('/api/localtasks/items', { method: 'DELETE', body });
}

/** 批量取消（POST /api/localtasks/items/cancel）。 */
export function cancelManyTasks(body: TaskScope & { ids: unknown[] }): Promise<TaskBulkResult> {
  return api('/api/localtasks/items/cancel', { method: 'POST', body });
}

/** 批量收口（POST /api/localtasks/items/close；status=done|cancelled）。 */
export function closeManyTasks(
  body: TaskScope & { ids: unknown[]; status: string; summary?: string },
): Promise<TaskBulkResult> {
  return api('/api/localtasks/items/close', { method: 'POST', body });
}

/** 恢复软删除的任务（POST /api/localtasks/tasks/restore）。 */
export function restoreTaskItem(body: TaskScope & { id: number }): Promise<unknown> {
  return api('/api/localtasks/tasks/restore', { method: 'POST', body });
}
