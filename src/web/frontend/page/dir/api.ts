// dir 页的 API 收口：页面组件（index / task-actions / task-feedback / task）只消费
// 这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
// scope：主题定位二选一——{ cwd } 或 { key }（全局池用 key=__GLOBAL__）。
import { api } from '../../api/client.js';
import type { ChainApi, GoalLogData } from './task-utils.js';

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
}

/** 任务链（GET /api/localtasks/chain?<q>）。 */
export function getTaskChain(query: string): Promise<ChainApi> {
  return api(`/api/localtasks/chain?${query}`);
}

/** 时间目标日志（GET /api/localtasks/timegoal-log?<q>）。 */
export function getGoalLog(query: string): Promise<GoalLogData> {
  return api(`/api/localtasks/timegoal-log?${query}`);
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

/** 克隆任务（POST /api/localtasks/clone）。 */
export function cloneTask(body: { id: number; cwd?: string }): Promise<TaskMutationResult> {
  return api('/api/localtasks/clone', { method: 'POST', body });
}

/** 派生任务（POST /api/localtasks/fork）。 */
export function forkTask(body: { id: number; cwd?: string }): Promise<TaskMutationResult> {
  return api('/api/localtasks/fork', { method: 'POST', body });
}

/** 任务附件清单（GET /api/localtasks/attachments?<q>；返回原样透出，调用方自行取字段）。 */
export function getTaskAttachments(query: string): Promise<any> {
  return api(`/api/localtasks/attachments?${query}`);
}

/** 领取预览（POST /api/localtasks/preview；不落任何状态）。 */
export function previewTask(body: Record<string, unknown>): Promise<any> {
  return api('/api/localtasks/preview', { method: 'POST', body });
}
