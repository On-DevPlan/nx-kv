// doc 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body / 编码方式与收口前逐字一致。
import { api } from '../../api/client.js';

/** docs 索引条目清单（GET /api/docs/index 的返回）。 */
export interface DocsIndex {
  index?: any[];
}

/** 读 docs 索引（GET /api/docs/index）。 */
export function getDocsIndex(): Promise<DocsIndex> {
  return api('/api/docs/index');
}

/** 参考仓库已登记的文档集（GET /api/repos/docs?id=<ownerKey>）。 */
export function repoDocs(ownerKey: string): Promise<any> {
  return api('/api/repos/docs?id=' + encodeURIComponent(ownerKey));
}

/** 看板清单（GET /api/boards）。 */
export function listBoards(): Promise<any> {
  return api('/api/boards');
}

/** 仓库清单（GET /api/repos）——加绑弹窗选宿主用。 */
export function listRepos(): Promise<any> {
  return api('/api/repos');
}

/** 读 docs 索引（同 getDocsIndex；供引言链接加载用，保留独立命名以便区分用途）。 */
export function loadDocsIndex(): Promise<any> {
  return api('/api/docs/index');
}

/** 某文档的附件清单（GET /api/docs/attachments?ref=<docId>）。 */
export function docAttachments(docId: string): Promise<any> {
  return api(`/api/docs/attachments?ref=${encodeURIComponent(docId)}`);
}

/** 文档条目（GET /api/docs/item?ref=… 的返回；原定义在页面里，收口时搬到这里）。 */
export interface DocItem {
  body?: string;
  title?: string;
  summary?: string;
  /** 短描述（v7）：列表 / 页头主标签 */
  desc?: string;
  /** refs.id（ref 的稳定地址） */
  refId?: string;
  path?: string;
  writable?: boolean;
  external?: boolean;
  docId?: string;
  [k: string]: any;
}

/** 按 ref 查单条文档（GET /api/docs/item?ref=…）。 */
export function getDocItem(ref: string): Promise<DocItem> {
  return api('/api/docs/item?ref=' + encodeURIComponent(ref));
}

export interface DocItemBody {
  ref: string;
  body?: string;
}

/** 写文档正文 / 描述（PATCH /api/docs/item）。 */
export function updateDocItem(body: { ref?: string; body?: string; desc?: string }): Promise<any> {
  return api('/api/docs/item', { method: 'PATCH', body });
}

/** 删除文档（DELETE /api/docs/item；ref 是 docId）。 */
export function removeDocItem(body: { ref?: string }): Promise<any> {
  return api('/api/docs/item', { method: 'DELETE', body });
}

/** 新建直接 ref（POST /api/docs/ref；desc + 归属，不创建任何文件）。 */
export function createRefDoc(body: {
  owner: 'repo' | 'group' | 'group_repo';
  repo?: string;
  group?: string;
  desc?: string;
}): Promise<{ refId: string; docId: string; desc?: string }> {
  return api('/api/docs/ref', { method: 'POST', body });
}

/** 把文档登记进参考仓库的文档集（POST /api/repos/docs）。 */
export function bindRepoDoc(body: { id: string; ref?: string; path?: string; note?: string; tag?: string }): Promise<any> {
  return api('/api/repos/docs', { method: 'POST', body });
}

/** 从参考仓库文档集摘掉一篇（DELETE /api/repos/docs；index 从 1 起，1 = 主篇）。 */
export function unbindRepoDoc(body: { id: string; index: number }): Promise<any> {
  return api('/api/repos/docs', { method: 'DELETE', body });
}

/** 一条文档归属（GET /api/docs/bindings 的一行）。 */
export interface DocBindingRow {
  refId: string;
  desc?: string;
  title?: string;
  /** 正文首行摘要（没有 `# 标题` 时的显示名兜底） */
  summary?: string;
  hasBody?: boolean;
  repoKey: string;
  groupKey: string | null;
  type: string;
  position: number;
  main: boolean;
  note?: string;
  tag?: string;
}

/** 解绑一条 ref 的归属（不删文档）。 */
export function unbindRef(body: {
  ref: string;
  type: 'repo' | 'group' | 'group_repo';
  repo: string;
  group?: string;
}): Promise<{ refId: string; removed: number; orphan: boolean }> {
  return api('/api/docs/unbind', { method: 'POST', body });
}

/** 把文档挂到看板附加列表（POST /api/docs/link）。 */
export function linkBoardDoc(body: { board: string; ref?: string; path?: string; note?: string; tag?: string }): Promise<any> {
  return api('/api/docs/link', { method: 'POST', body });
}

/** 从看板附加文档列表摘掉第 N 条（POST /api/docs/link；remove 从 1 起）。 */
export function unlinkBoardDoc(body: { board: string; remove: number }): Promise<any> {
  return api('/api/docs/link', { method: 'POST', body });
}

/** 宿主文档集（GET /api/docs/bindings?host=<repoKey> 或 ?group=<组 key>）。 */
export function docHostBindings(params: { host?: string; group?: string }): Promise<{ bindings?: DocBindingRow[] }> {
  const q = new URLSearchParams();
  if (params.host) q.set('host', params.host);
  if (params.group) q.set('group', params.group);
  return api('/api/docs/bindings?' + q.toString());
}

/** 文档归属清单（GET /api/docs/bindings?ref=<docId>）。 */
export function docBindings(ref: string): Promise<{ bindings?: DocBindingRow[] }> {
  return api('/api/docs/bindings?ref=' + encodeURIComponent(ref));
}
