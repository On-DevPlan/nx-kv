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
    { method:'PATCH', body:{…} } 整个当 patch 传进来，宽类型查不出来。 */
export interface LocaltaskSettingPatch {
  timeoutSec?: number;
  ackPrompt?: string | string[];
  appendMode?: 'xml' | 'plain';
  blockTemplates?: unknown;
}

/** 改 localtask 设置（PATCH /api/localtasks/setting；blockTemplates / appendMode 等）。 */
export function saveLocaltaskSettings(patch: LocaltaskSettingPatch): Promise<any> {
  return api('/api/localtasks/setting', { method: 'PATCH', body: patch });
}

/**
 * 提示词插件注册表（GET /api/prompt/registry）：8 段的生效模板 / 变量目录 / 顺序位。
 * 区块 tab、标签、每段「可使用参数」清单全部从这里派生——不再手写第二份
 * （prompt-template-params.ts 已删除，方案 §7：声明是 UI 的唯一数据源）。
 */
export function getPromptRegistry(): Promise<any> {
  return api('/api/prompt/registry');
}

/**
 * 写提示词插件顺序数组（PUT /api/prompt/order，方案 §5.1）。
 * 唯一真相是数组：必须恰好包含全部插件 id 各一次；顺序位 = 数组下标 × 10。
 */
export function savePromptOrder(order: string[]): Promise<any> {
  return api('/api/prompt/order', { method: 'PUT', body: { order } });
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

/** 并发拉仓库清单与看板清单（侧栏分组用）。 */
export function loadReposAndBoards(): Promise<any> {
  return Promise.all([api('/api/repos'), api('/api/boards')]);
}
