// group 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
import { api } from '../../api/client.js';

/** 恢复软删除的任务（POST /api/localtasks/tasks/restore；CLI localtask task-restore 等价）。 */
export function restoreTask(body: { cwd?: string; id?: number | string }): Promise<any> {
  return api('/api/localtasks/tasks/restore', { method: 'POST', body });
}

/** 删除单个本地任务（DELETE /api/localtasks/item；purge=true 彻底删除不可恢复）。 */
export function removeTask(body: { cwd?: string; id?: number | string; purge?: boolean }): Promise<any> {
  return api('/api/localtasks/item', { method: 'DELETE', body });
}

/** 队列内调序（PATCH /api/localtasks/reorder；beforeId / afterId 二选一）。 */
export function reorderTask(body: {
  cwd?: string;
  id?: number | string;
  beforeId?: number | string;
  afterId?: number | string;
}): Promise<any> {
  return api('/api/localtasks/reorder', { method: 'PATCH', body });
}
