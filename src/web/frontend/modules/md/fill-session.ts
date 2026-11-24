// 参数填写页的一次性会话（#151）：从「新建任务」下拉点带槽位的模板时建立，
// 路由只带 sessionId（#/templates/fill/<id>），上下文放这里，避免给 AppRoute 加
// 一堆一次性的 query 键。会话是内存态——这是中间页，刷新即丢是可接受的。
export interface FillSession {
  templateId: string;
  /** 可见域三把钥匙（用于主题级模板管理返回等，当前主要供展示） */
  topic?: string;
  group?: string;
  repo?: string;
  /** 新建落点：dirKey 开目录任务页；groupId 开组锚定页 */
  dirKey?: string;
  groupId?: string;
  /** 任务正文 frontmatter 的归属（组任务路由用） */
  board?: string;
  project?: string;
  /** 填完是否直接提交落库（false = 进编辑页保留草稿） */
  submit?: boolean;
}

let seq = 0;
const sessions = new Map<string, FillSession>();

export function putFillSession(session: FillSession): string {
  seq += 1;
  const id = `fill_${Date.now().toString(36)}_${seq}`;
  sessions.set(id, { ...session });
  return id;
}

export function getFillSession(id: unknown): FillSession | undefined {
  return sessions.get(String(id || ''));
}

export function dropFillSession(id: unknown): void {
  sessions.delete(String(id || ''));
}
