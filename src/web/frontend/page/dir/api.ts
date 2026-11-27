// dir 页的 API 收口：页面组件（index / task-actions / task-feedback / task）只消费
// 这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
// #251 起任务 CRUD / 批量那一组下沉到 api/tasks.ts（组页与任务页模板共用），
// 这里 re-export 保持既有 import 面不变。
import { api } from '../../api/client.js';
import type { TaskMutationResult } from '../../api/tasks.js';
import type { ChainApi, GoalLogData } from './task-utils.js';

export * from '../../api/tasks.js';

/** 任务链（GET /api/localtasks/chain?<q>）。 */
export function getTaskChain(query: string): Promise<ChainApi> {
  return api(`/api/localtasks/chain?${query}`);
}

/** 时间目标日志（GET /api/localtasks/timegoal-log?<q>）。 */
export function getGoalLog(query: string): Promise<GoalLogData> {
  return api(`/api/localtasks/timegoal-log?${query}`);
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

/** mdfile 正文（GET /api/docs/mdfile?attachment=<id>；读时校验指纹）。 */
export function getMdfileContent(id: string): Promise<{ body?: string; absPath?: string; stale?: boolean; missing?: boolean }> {
  return api(`/api/docs/mdfile?attachment=${encodeURIComponent(id)}`);
}

/** 领取预览（POST /api/localtasks/preview；不落任何状态）。 */
export function previewTask(body: Record<string, unknown>): Promise<any> {
  return api('/api/localtasks/preview', { method: 'POST', body });
}

/** 草稿提交后通知插件迁移草稿键数据（POST /api/plugins/task-created；失败不影响任务）。 */
export function notifyPluginTaskCreated(body: {
  draftKey: string;
  taskId: number;
  taskText?: string;
  topic?: string;
  group?: string;
  repo?: string;
  cwd?: string;
  boardKey?: string;
  projectKey?: string;
  status?: string;
}): Promise<{ notified?: string[]; warnings?: string[] }> {
  return api('/api/plugins/task-created', { method: 'POST', body });
}

/** gettask 插件区块声明（GET /api/plugins/gettask；任务编辑页 dock tab）。 */
export function getTaskPlugins(query: { topic?: string; taskId?: string }): Promise<{
  entries?: any[];
  warnings?: string[];
}> {
  const q = new URLSearchParams();
  if (query.topic) q.set('topic', query.topic);
  if (query.taskId) q.set('taskId', query.taskId);
  const s = q.toString();
  return api(`/api/plugins/gettask${s ? `?${s}` : ''}`);
}
