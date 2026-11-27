// plugin_state：插件全局开关。缺行 = 用插件 manifest 的 defaultEnabled。
import { db, txw } from './db.js';
import type { DbApi } from '../../../core/db/driver.js';

export interface PluginStateRow {
  pluginId: string;
  enabled: boolean;
}

export function allState(conn: DbApi = db()): PluginStateRow[] {
  const rows = conn.all('SELECT plugin_id, enabled FROM plugin_state ORDER BY plugin_id');
  return rows.map((r) => ({ pluginId: String(r.plugin_id), enabled: !!Number(r.enabled) }));
}

export function stateOf(pluginId: string, conn: DbApi = db()): boolean | null {
  const row = conn.get('SELECT enabled FROM plugin_state WHERE plugin_id = :id', { id: pluginId });
  return row ? !!Number(row.enabled) : null;
}

export function setState(pluginId: string, enabled: boolean, conn?: DbApi): void {
  const at = Date.now();
  const write = (c: DbApi) => {
    c.run(
      `INSERT INTO plugin_state (plugin_id, enabled, updated_at)
       VALUES (:id, :enabled, :at)
       ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      { id: pluginId, enabled: enabled ? 1 : 0, at },
    );
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}
