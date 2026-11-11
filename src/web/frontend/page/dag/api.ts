// dag 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
import { api } from '../../api/client.js';
import type { DepToken } from './model.js';

/** PATCH /api/localtasks/item 的补丁形状（依赖令牌数组在 CLI 侧按逗号短写传递）。 */
export interface DagPatchBody {
  blockBy?: DepToken[] | string;
  gate?: boolean;
  duration?: string;
  clearGoal?: boolean;
}

/** 编辑单个本地任务（PATCH /api/localtasks/item；CLI localtask update 等价）。 */
export function patchTaskItem(
  body: { key?: string; cwd?: string; id: number } & DagPatchBody,
): Promise<any> {
  return api('/api/localtasks/item', { method: 'PATCH', body });
}
