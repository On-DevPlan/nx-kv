// overview 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
// 入参类型按页面实际用法声明（ids 是 number，服务端归一化层会统一转成字符串）。
import { api } from '../../api/client.js';

/** 批量软删除返回：count=成功删除数；missing=没找到的编号。 */
export interface RemoveManyResult {
  count?: number;
  missing?: number[];
}

/** 批量软删除任务（DELETE /api/localtasks/items；CLI localtask remove-many 等价）。 */
export function removeTasks(input: { key: string; ids: number[] }): Promise<any> {
  return api('/api/localtasks/items', { method: 'DELETE', body: input });
}

/** 批量收口返回：count=收口数；claimedClosed=其中原本已领取的；skipped=终态跳过明细。 */
export interface CloseManyResult {
  count?: number;
  claimedClosed?: number[];
  skipped?: Array<{ id: number; status?: string; reason?: string }>;
  missing?: number[];
}

/** 批量收口任务（POST /api/localtasks/items/close；status=done|cancelled）。 */
export function closeTasks(input: { key: string; ids: number[]; status: string; summary?: string }): Promise<CloseManyResult> {
  return api('/api/localtasks/items/close', { method: 'POST', body: input });
}
