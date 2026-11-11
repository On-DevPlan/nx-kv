// refs 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / 编码方式与收口前逐字一致。
import { api } from '../../api/client.js';

/** 参考仓库已登记的文档集（GET /api/repos/docs?id=<repoKey>）。 */
export function repoDocs(repoKey: string): Promise<any> {
  return api('/api/repos/docs?id=' + encodeURIComponent(repoKey));
}

/** 看板详情（GET /api/boards/<boardKey>）。 */
export function boardDetail(boardKey: string): Promise<any> {
  return api('/api/boards/' + encodeURIComponent(String(boardKey)));
}
