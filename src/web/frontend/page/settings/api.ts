// settings 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
import { api } from '../../api/client.js';

/** 读本机设置（GET /api/setting；CLI setting get 等价）。 */
export function getSettings(): Promise<any> {
  return api('/api/setting');
}

/** 改本机设置（POST /api/setting；只改传入项，返回归一后的全量）。 */
export function saveSettings(patch: Record<string, unknown>): Promise<any> {
  return api('/api/setting', { method: 'POST', body: patch });
}

/** 读 localtask 全量（GET /api/localtasks；settings 段带提示词模板与追加模式）。 */
export function getLocaltaskSettings(): Promise<any> {
  return api('/api/localtasks');
}

/** 改 localtask 设置（PATCH /api/localtasks/setting；blockTemplates / appendMode 等）。 */
export function saveLocaltaskSettings(patch: Record<string, unknown>): Promise<any> {
  return api('/api/localtasks/setting', { method: 'PATCH', body: patch });
}

/** 并发拉仓库清单与看板清单（侧栏分组用）。 */
export function loadReposAndBoards(): Promise<any> {
  return Promise.all([api('/api/repos'), api('/api/boards')]);
}
