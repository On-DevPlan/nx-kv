// 主题级模板管理页的一次性会话（#151）：「管理模板…」从某个 topic 的下拉进入，
// 只显示/管理这个 topic 下可见的模板。路由只带 sessionId，避免给 AppRoute 加
// 一次性的 group/repo query 键。
export interface ManageSession {
  topic?: string;
  group?: string;
  repo?: string;
  /** 展示用标题前缀（目录名 / 组名） */
  label?: string;
}

let seq = 0;
const sessions = new Map<string, ManageSession>();

export function putManageSession(session: ManageSession): string {
  seq += 1;
  const id = `mng_${Date.now().toString(36)}_${seq}`;
  sessions.set(id, { ...session });
  return id;
}

export function getManageSession(id: unknown): ManageSession | undefined {
  return sessions.get(String(id || ''));
}
