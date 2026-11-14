// refs 面板的 API 收口：列表读「ref + 归属」，新建/摘除直接操作 ref_bindings。
//
// 口径（v7 / 任务 #97）：ref 是 DB 实体，没有路径 / 文件名 / 扩展名；
// 面板只消费 refId + desc + type（repo / group / group_repo）。
import { api } from '../api/client.js';

/** 一条归属行（GET /api/docs/bindings 的 bindings[]）。 */
export interface BindingRow {
  refId: string;
  desc: string;
  title: string;
  /** 正文首行摘要（没有 `# 标题` 时的显示名兜底） */
  summary: string;
  hasBody: boolean;
  type: 'repo' | 'group' | 'group_repo';
  repoKey: string;
  groupKey: string | null;
  position: number;
  main: boolean;
  note: string;
  tag: string;
}

/** 某个宿主的文档集（仓库 → host；组 → group）。 */
export function docsBindings(q: { host?: string; group?: string }): Promise<{ bindings: BindingRow[] }> {
  const usp = new URLSearchParams();
  if (q.host) usp.set('host', q.host);
  if (q.group) usp.set('group', q.group);
  return api('/api/docs/bindings?' + usp.toString());
}

/** 新建直接 ref（desc + 归属；正文为空、直接可编辑）。 */
export function createRef(body: {
  desc?: string;
  owner: 'repo' | 'group' | 'group_repo';
  repo?: string;
  group?: string;
}): Promise<{ refId: string; docId: string; desc: string }> {
  return api('/api/docs/ref', { method: 'POST', body });
}

/** 解绑一条直接 ref 的归属（不删文档）。 */
export function unbindRef(body: {
  ref: string;
  type: 'repo' | 'group' | 'group_repo';
  repo: string;
  group?: string;
}): Promise<{ refId: string; removed: number; orphan: boolean }> {
  return api('/api/docs/unbind', { method: 'POST', body });
}

/** 改 ref 的短描述（只动 desc，不碰正文）。 */
export function setDocDesc(ref: string, desc: string): Promise<any> {
  return api('/api/docs/item', { method: 'PATCH', body: { ref, desc } });
}

/** 写文档正文 / 描述（PATCH /api/docs/item）——列表的「改 desc」与编辑页保存共用。 */
export function updateDocItem(body: { ref?: string; body?: string; desc?: string }): Promise<any> {
  return api('/api/docs/item', { method: 'PATCH', body });
}

/** 删除文档（DELETE /api/docs/item；ref 是 docId）。 */
export function removeDocItem(body: { ref?: string }): Promise<any> {
  return api('/api/docs/item', { method: 'DELETE', body });
}
