// plugin_storage_migrations：插件自己表结构的版本账本。
import { db, txw } from './db.js';
import type { DbApi } from '../../../core/db/driver.js';

export function versionOf(pluginId: string, conn: DbApi = db()): number {
  const row = conn.get('SELECT version FROM plugin_storage_migrations WHERE plugin_id = :id', { id: pluginId });
  return row ? Number(row.version) || 0 : 0;
}

export function setVersion(pluginId: string, version: number, conn?: DbApi): void {
  const at = Date.now();
  const write = (c: DbApi) => {
    c.run(
      `INSERT INTO plugin_storage_migrations (plugin_id, version, applied_at)
       VALUES (:id, :v, :at)
       ON CONFLICT(plugin_id) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at`,
      { id: pluginId, v: Math.max(0, Math.trunc(version) || 0), at },
    );
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}
