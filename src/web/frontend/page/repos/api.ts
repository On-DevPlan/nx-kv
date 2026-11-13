// repos 页的 API 收口：页面组件（index / 各弹窗 / 分区组件）只消费这里的函数，
// 不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body / 编码方式与收口前逐字一致。
import { api } from '../../api/client.js';
import type { BoardsPayload, RefCheckRow, RepoRecord } from './repo-table.js';

/** 参考仓库体检结果（GET /api/repos/ref/check；原定义在页面里，收口时搬到这里）。 */
export interface RefCheckPayload {
  refRepos?: RefCheckRow[];
}

/** 存储根设置（GET/POST /api/setting；原定义在 ref-panel 里，收口时搬到这里）。 */
export interface SettingInfo {
  gitRepoRoot?: string;
  gitDevRoot?: string;
}

/** 仓库的远程地址清单（GET /api/repos/remote/list；原定义在弹窗里，收口时搬到这里）。 */
/** 单个远程地址（原定义在弹窗里，收口时搬到这里）。 */
export interface RemoteItem {
  name: string;
  url: string;
  side?: string;
  [k: string]: any;
}

export interface RemoteInfo {
  key: string;
  name: string;
  current?: string;
  remotes: RemoteItem[];
}

/** 远程存在性检查结果（GET /api/repos/remote/check；原定义在弹窗里，收口时搬到这里）。 */
export interface CheckState {
  url: string;
  status: string;
  detail?: string;
}

/** 仓库清单（GET /api/repos）。 */
export function listRepos(): Promise<RepoRecord[]> {
  return api('/api/repos');
}

/** 看板清单（GET /api/boards）。 */
export function listBoards(): Promise<BoardsPayload> {
  return api('/api/boards');
}

/** 参考仓库体检（GET /api/repos/ref/check）。 */
export function fetchRefCheck(): Promise<RefCheckPayload> {
  return api('/api/repos/ref/check');
}

/** 读本机设置（GET /api/setting）。 */
export function getSettings(): Promise<any> {
  return api('/api/setting');
}

/** 改本机设置（POST /api/setting；只改传入项）。 */
export function saveSettings(body: any): Promise<any> {
  return api('/api/setting', { method: 'POST', body });
}

/** 仓库的远程地址清单（GET /api/repos/remote/list?id=…）。 */
export function listRemotes(repoKey: string): Promise<any> {
  return api('/api/repos/remote/list?id=' + encodeURIComponent(repoKey));
}

/** 远程存在性检查（GET /api/repos/remote/check?id=…[&url=…]）。 */
export function checkRemote(key: string, url?: string): Promise<any> {
  return api(
    '/api/repos/remote/check?id=' +
      encodeURIComponent(key) +
      (url ? '&url=' + encodeURIComponent(url) : ''),
  );
}

// —— 绑定关系（ref ↔ board / repo）——

/** 绑定参考仓库到看板 / 开发仓库（POST /api/repos/bind；remove=true 摘除）。 */
export function bindRef(body: { id?: string; board?: string[]; repo?: string[]; remove?: boolean }): Promise<any> {
  return api('/api/repos/bind', { method: 'POST', body });
}

/** 给参考仓库写备注（POST /api/repos/ref/note）。 */
export function refNote(body: { id?: string; board?: string; note?: string }): Promise<any> {
  return api('/api/repos/ref/note', { method: 'POST', body });
}

/** 同步参考仓库（POST /api/repos/ref/sync；{id} 单个或 {all:true} 全量）。 */
export function refSync(body: { id?: string; all?: boolean }): Promise<any> {
  return api('/api/repos/ref/sync', { method: 'POST', body });
}

/** 克隆参考仓库（POST /api/repos/ref/clone）。 */
export function refClone(body: any): Promise<any> {
  return api('/api/repos/ref/clone', { method: 'POST', body });
}

// —— 看板 ——

/** 改看板（PATCH /api/boards/:id）。 */
export function updateBoard(id: string, body: any): Promise<any> {
  return api(`/api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

/** 建看板（POST /api/boards）。 */
export function createBoard(body: any): Promise<any> {
  return api('/api/boards', { method: 'POST', body });
}

/** 删看板（DELETE /api/boards/:id；body 空对象与收口前一致）。 */
export function deleteBoard(id: string) {
  return api(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
}

/** 导入看板布局（POST /api/boards/import）。 */
export function importBoards(body: { json?: string }): Promise<any> {
  return api('/api/boards/import', { method: 'POST', body });
}

/** 导出看板布局（GET /api/boards/export）。 */
export function exportBoards(): Promise<any> {
  return api('/api/boards/export');
}

/** 看板改 key（POST /api/boards/rekey）。 */
export function rekeyBoard(body: { from?: any; to?: any }): Promise<any> {
  return api('/api/boards/rekey', { method: 'POST', body });
}

/** 把未绑定队列绑到看板（POST /api/boards/assign）。 */
export function assignBoard(body: { key?: string; board?: string; remove?: boolean }): Promise<any> {
  return api('/api/boards/assign', { method: 'POST', body });
}

/** 清理空看板（POST /api/boards/prune；apply=false 只预览）。 */
export function pruneBoards(body: { apply?: boolean }): Promise<any> {
  return api('/api/boards/prune', { method: 'POST', body });
}

// —— 仓库本体 ——

/** 登记仓库（POST /api/repos）。 */
export function addRepo(body: any): Promise<any> {
  return api('/api/repos', { method: 'POST', body });
}

/** 改仓库（PATCH /api/repos/:id）。 */
export function updateRepo(id: string, body: any): Promise<any> {
  return api(`/api/repos/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

/** 删仓库（DELETE /api/repos/:id）。 */
export function removeRepo(id: string): Promise<any> {
  return api(`/api/repos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 登记前探测 remote（POST /api/repos/detect）。 */
export function detectRepo(body: { path?: string }): Promise<any> {
  return api('/api/repos/detect', { method: 'POST', body });
}

/** 在文件管理器 / IDE 打开仓库目录（POST /api/repos/open）。 */
export function openRepo(body: { id?: string }): Promise<any> {
  return api('/api/repos/open', { method: 'POST', body });
}

/** 克隆仓库并登记（POST /api/repos/clone）。 */
export function cloneRepo(body: { remote?: string; key?: string; name?: string; type?: string }): Promise<any> {
  return api('/api/repos/clone', { method: 'POST', body });
}

/** 收紧远程地址（POST /api/repos/remote/pick）。 */
export function pickRemote(body: { id?: string; url?: string }): Promise<any> {
  return api('/api/repos/remote/pick', { method: 'POST', body });
}

// —— 文档 ——

/** 全仓文档搜索（GET /api/docs）。 */
export function listDocs(): Promise<any> {
  return api('/api/docs');
}

/** 全部文档归属（GET /api/docs/bindings，不带筛选参数）。 */
export function listDocBindings(): Promise<any> {
  return api('/api/docs/bindings');
}

/** 删除文档（DELETE /api/docs/item）。 */
export function removeDocItem(body: { ref?: string }) {
  return api('/api/docs/item', { method: 'DELETE', body });
}
