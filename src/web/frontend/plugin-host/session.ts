// 插件页面的一次性 session（entry-form 用）：路由只带 sessionId，避免给 AppRoute
// 加一堆一次性 query 键。内存态；刷新丢失可接受（与旧模板参数页同口径）。
import type { EntryView, PretaskContext } from '@nx-kv/plugin-sdk';

export interface PluginPageSession {
  pluginId: string;
  pageId: string;
  entryId: string;
  ctx: PretaskContext;
  entry: EntryView;
}

const sessions = new Map<string, PluginPageSession>();
let seq = 0;

export function putPluginPageSession(session: PluginPageSession): string {
  seq += 1;
  const id = `ps_${Date.now().toString(36)}_${seq}`;
  sessions.set(id, { ...session });
  return id;
}

export function getPluginPageSession(id: unknown): PluginPageSession | undefined {
  return sessions.get(String(id || ''));
}

export function dropPluginPageSession(id: unknown): void {
  sessions.delete(String(id || ''));
}
