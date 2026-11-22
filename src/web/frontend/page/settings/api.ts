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

/** 读孤儿文档清单（GET /api/docs/orphans；CLI docs orphans 等价）。 */
export function getOrphans(): Promise<any> {
  return api('/api/docs/orphans');
}

/** 预演 / 执行孤儿到期清理（POST /api/docs/orphans/purge；缺省只预演）。 */
export function purgeOrphans(patch: { apply?: boolean; ttlDays?: number } = {}): Promise<any> {
  return api('/api/docs/orphans/purge', { method: 'POST', body: patch });
}

/** 读 localtask 全量（GET /api/localtasks；settings 段带提示词模板与追加模式）。 */
export function getLocaltaskSettings(): Promise<any> {
  return api('/api/localtasks');
}

/** localtask 设置的 patch 形状（驼峰；与 PATCH /api/localtasks/setting 的契约一致）。
    收窄成具体字段而不是 Record<string,unknown>：#104 的 bug 就是调用方把
    { method:'PATCH', body:{…} } 整个当 patch 传进来，宽类型查不出来。
    #152 起提示词模板不可写（正文在插件类里），只剩超时与追加模式两个键。 */
export interface LocaltaskSettingPatch {
  timeoutSec?: number;
  appendMode?: 'xml' | 'plain';
}

/** 改 localtask 设置（PATCH /api/localtasks/setting；timeoutSec / appendMode）。 */
export function saveLocaltaskSettings(patch: LocaltaskSettingPatch): Promise<any> {
  return api('/api/localtasks/setting', { method: 'PATCH', body: patch });
}

/**
 * 提示词插件注册表（GET /api/prompt/registry）：
 * `{ groups: { get: [...], check: [...], done: [...] }, plugins: [...] }`——
 * 时机链 + 每段内置模板正文 + 变量目录，全部从插件类派生（#152）。
 * 设置页的段落导航、正文、变量清单都只读自这里，不写第二份。
 */
export function getPromptRegistry(): Promise<any> {
  return api('/api/prompt/registry');
}

/** 保存段模板（新建/编辑用户条目；POST /api/prompt/template/save）。 */
export function savePromptTemplate(input: {
  segment: string;
  id?: string;
  name?: string;
  text: string;
}): Promise<any> {
  return api('/api/prompt/template/save', { method: 'POST', body: input });
}

/** 切换段启用的模板（POST /api/prompt/template/activate；id=builtin 回出厂）。 */
export function activatePromptTemplate(segment: string, id: string): Promise<any> {
  return api('/api/prompt/template/activate', { method: 'POST', body: { segment, id } });
}

/** 删除段的一条用户模板（POST /api/prompt/template/delete）。 */
export function deletePromptTemplate(segment: string, id: string): Promise<any> {
  return api('/api/prompt/template/delete', { method: 'POST', body: { segment, id } });
}

/** 预览一条任务的交付（POST /api/localtasks/preview；与 CLI localtask preview 同一链路）。 */
export function previewDelivery(input: {
  id?: number;
  text?: string;
  cwd?: string;
  key?: string;
  summary?: string;
  params?: Record<string, string>;
}): Promise<any> {
  return api('/api/localtasks/preview', { method: 'POST', body: input });
}

