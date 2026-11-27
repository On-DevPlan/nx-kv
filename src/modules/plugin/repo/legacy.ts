// plugin_legacy_data：宿主暂存的旧数据（如 v18 templates），插件首次激活时消费。
import { db, txw } from './db.js';
import type { DbApi } from '../../../core/db/driver.js';

export function legacyKinds(pluginId: string, conn: DbApi = db()): string[] {
  return conn
    .all('SELECT kind FROM plugin_legacy_data WHERE plugin_id = :p ORDER BY kind', { p: pluginId })
    .map((r) => String(r.kind));
}

export function getLegacy(pluginId: string, kind: string, conn: DbApi = db()): unknown | null {
  const row = conn.get(
    'SELECT payload_json FROM plugin_legacy_data WHERE plugin_id = :p AND kind = :k',
    { p: pluginId, k: kind },
  );
  if (!row) return null;
  try {
    return JSON.parse(String(row.payload_json));
  } catch {
    return null;
  }
}

export function putLegacy(pluginId: string, kind: string, payload: unknown, conn?: DbApi): void {
  const at = Date.now();
  const body = JSON.stringify(payload ?? null);
  const write = (c: DbApi) => {
    c.run(
      `INSERT INTO plugin_legacy_data (plugin_id, kind, payload_json, created_at)
       VALUES (:p, :k, :body, :at)
       ON CONFLICT(plugin_id, kind) DO UPDATE SET payload_json = excluded.payload_json`,
      { p: pluginId, k: kind, body, at },
    );
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}

export function deleteLegacy(pluginId: string, kind: string, conn?: DbApi): void {
  const write = (c: DbApi) => {
    c.run('DELETE FROM plugin_legacy_data WHERE plugin_id = :p AND kind = :k', { p: pluginId, k: kind });
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}
