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
