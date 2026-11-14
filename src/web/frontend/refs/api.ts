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
  /** 宿主 kind（#132）：dev 开发仓库 / ref 参考仓库 / group 组。
   *  参考仓库与开发仓库在底层只有这一个差异，列表上要标得出来。 */
  hostKind?: 'dev' | 'ref' | 'group' | string;
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

/**
 * 组 / 仓库绑定的参考仓库（含绑定描述）。
 * #132：右侧栏文档列表要能就地看 / 改「这个参考在本组里参考什么」——
 * 过去这件事散在中心弹窗里，文档面被切成了两半。
 */
export interface RefRepoBinding {
  id?: string;
  key: string;
  name: string;
  desc?: string;
  remote?: string;
  path?: string;
  note: string;
}

export interface RefReposOf {
  repo?: { id?: string; key?: string; name?: string; path?: string; desc?: string };
  board?: { id?: string; key?: string; name?: string };
  /** 直接绑定到本仓库的（仅 --id 视图） */
  direct?: RefRepoBinding[];
  /** 本组绑定的（--board 视图） */
  refRepos?: RefRepoBinding[];
}

/** 某仓库直接绑定的参考仓库 + 所属组绑定的（--id 视图）。 */
export function repoRefRepos(id: string): Promise<RefReposOf> {
  return api('/api/repos/ref/of?id=' + encodeURIComponent(id));
}

/** 某组绑定的参考仓库（--board 视图，带绑定描述）。 */
export function boardRefRepos(board: string): Promise<RefReposOf> {
  return api('/api/repos/ref/of?board=' + encodeURIComponent(board));
}

/** 写 / 清绑定描述（这个参考在该组 / 该仓库里参考什么）。 */
export function setRefNote(body: { id: string; board?: string; repo?: string; note?: string }): Promise<any> {
  return api('/api/repos/ref/note', { method: 'POST', body });
}
