// progress 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
// ids 允许 number：服务端归一化层会统一转成字符串。
import { api } from '../../api/client.js';

/** 批量软删除返回：count=成功删除数；missing=没找到的编号。 */
export interface RemoveManyResult {
  count?: number;
  missing?: number[];
}

/** 批量软删除任务（DELETE /api/localtasks/items；CLI localtask remove-many 等价）。 */
export function removeTasks(input: {
  key?: string;
  cwd?: string;
  ids: (number | undefined)[];
}): Promise<any> {
  return api('/api/localtasks/items', { method: 'DELETE', body: input });
}

/** 恢复一条软删任务（POST /api/localtasks/tasks/restore；#208 撤回弹窗用）。 */
export function restoreTask(input: {
  key?: string;
  cwd?: string;
  id: number;
}): Promise<any> {
  return api('/api/localtasks/tasks/restore', { method: 'POST', body: input });
}

/** 任务链（GET /api/localtasks/chain?<q>；#245 进程面板「只展示当前任务的任务链」）。 */
export function getTaskChain(query: string): Promise<any> {
  return api(`/api/localtasks/chain?${query}`);
}
