// cloud 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 只搬调用不改语义：路径 / 方法 / body 与收口前逐字一致。
import { api } from '../../api/client.js';

/** 登录并保存 token 到本机配置（POST /api/auth/login）。 */
export function authLogin(body: { email: string; password: string }): Promise<any> {
  return api('/api/auth/login', { method: 'POST', body });
}

/** 清除本机保存的 token（POST /api/auth/logout）。 */
export function authLogout(): Promise<any> {
  return api('/api/auth/logout', { method: 'POST' });
}

/** 清单里的一条任务（/api/todo 三个桶的元素）。 */
export interface TodoTask {
  id: number | string;
  text: string;
  topic?: string;
  note?: string;
  createdAt?: string;
  doneAt?: string;
  frozenAt?: string;
}

/** 清单出站形状（桶名固定三个）。 */
export interface TodoData {
  open?: TodoTask[];
  done?: TodoTask[];
  freeze?: TodoTask[];
  topics?: string[];
  [k: string]: any;
}

/** 读云端清单（GET /api/todo；CLI todo list 等价）。 */
export function listTodos(): Promise<any> {
  return api('/api/todo');
}

/** 读本机设置（GET /api/setting）。 */
export function getSettings(): Promise<any> {
  return api('/api/setting');
}

/** 改本机设置（POST /api/setting；只改传入项，返回归一后的全量）。 */
export function saveSettings(patch: Record<string, unknown>): Promise<any> {
  return api('/api/setting', { method: 'POST', body: patch });
}

/** todo 定位键：当前内容 + 可选的消歧 pick。 */
export interface TodoLocateBody {
  group?: number;
  // 页面按「定位键」组装 body（内容 + 可选消歧），具体形状由后端契约决定
  ref?: any;
  pick?: any;
  [k: string]: unknown;
}

/** 完成任务（POST /api/todo/done；result 是可选的完成结果一句话）。 */
export function doneTask(body: TodoLocateBody & { result?: any }): Promise<any> {
  return api('/api/todo/done', { method: 'POST', body });
}

/** 冻结任务（POST /api/todo/freeze）。 */
export function freezeTask(body: TodoLocateBody): Promise<any> {
  return api('/api/todo/freeze', { method: 'POST', body });
}

/** 解冻任务（POST /api/todo/unfreeze）。 */
export function unfreezeTask(body: TodoLocateBody): Promise<any> {
  return api('/api/todo/unfreeze', { method: 'POST', body });
}

/** 删除任务（DELETE /api/todo/item；按内容定位）。 */
export function removeTask(body: TodoLocateBody): Promise<any> {
  return api('/api/todo/item', { method: 'DELETE', body });
}

/** 归档返回：moved=移动条数；coldKey=冷 key。 */
export interface ArchiveResult {
  moved?: number;
  coldKey?: string;
}

/** 归档已完成的旧记录（POST /api/todo/archive；before 是 YYYY-MM-DD）。 */
export function archiveDone(body: { before?: string; group?: number }): Promise<any> {
  return api('/api/todo/archive', { method: 'POST', body });
}

/** 加任务返回：topicAdded=是否新建了主题。 */
export interface AddTodoResult {
  topicAdded?: boolean;
}

/** 加任务（POST /api/todo）。 */
export function addTodo(body: { topic: string; text: string; group?: number }): Promise<any> {
  return api('/api/todo', { method: 'POST', body });
}
