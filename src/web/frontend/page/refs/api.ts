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

// ─── 管理动作（#186：从 DocsModal 搬进来，动作本身与弹窗时代一致）────────────

/** 摘除一条登记（仓库侧：DELETE /api/repos/docs，index 1=主篇绑定、≥2=docLinks[n-2]）。 */
export function removeRepoDoc(repoKey: string, index: number): Promise<any> {
  return api('/api/repos/docs', { method: 'DELETE', body: { id: repoKey, index } });
}

/** 摘除一条登记（看板侧：POST /api/docs/link，remove 是 docLinks 的 1-based 序号）。 */
export function removeBoardDoc(boardKey: string, index: number): Promise<any> {
  return api('/api/docs/link', { method: 'POST', body: { board: boardKey, remove: index } });
}

/** 落一篇 reference 文档（POST /api/docs/item）。 */
export function createDocItem(rel: string, body: string): Promise<any> {
  return api('/api/docs/item', { method: 'POST', body: { rel, body } });
}

/** 把 reference 登记到仓库介绍集（POST /api/repos/docs）。 */
export function addRepoDoc(repoKey: string, rel: string, tag?: string): Promise<any> {
  return api('/api/repos/docs', { method: 'POST', body: { id: repoKey, rel, tag: tag || undefined } });
}

/** 把 reference 登记到看板介绍集（POST /api/docs/link）。 */
export function addBoardDoc(boardKey: string, rel: string, tag?: string): Promise<any> {
  return api('/api/docs/link', { method: 'POST', body: { board: boardKey, doc: rel, tag: tag || undefined } });
}
