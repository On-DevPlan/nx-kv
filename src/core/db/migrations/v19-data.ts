// v18 → v19 数据迁移：把旧任务模板的用户行搬进 plugin_legacy_data 暂存。
//
// 内置行（builtin=1）不搬：任务模板的内置正文改为插件包代码声明。
// templates 表暂不删除（v20 在旧内置实现删除后 drop），这里只做一次性暂存。
import type { DbApi } from '../driver.js';

export interface V19Context {
  atMs?: number;
}

const KIND = 'templates';
const PLUGIN_ID = 'task-template';

/** 读旧 templates 的用户行；表不存在时返回空。 */
function readUserRows(conn: DbApi): any[] {
  const has = conn.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'");
  if (!has) return [];
  return conn.all(
    `SELECT id, name, body, vars_schema, vars, is_default, sort_order, scope, origin_topic,
            created_at, updated_at, builtin, category
       FROM templates
      WHERE category = 'newtask' AND builtin = 0 AND deleted_at IS NULL
      ORDER BY sort_order, id`,
  );
}

function readDefaultId(conn: DbApi): string {
  const has = conn.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'");
  if (!has) return 'newtask.ref';
  const row = conn.get(
    "SELECT id FROM templates WHERE category = 'newtask' AND is_default = 1 AND deleted_at IS NULL LIMIT 1",
  );
  return row ? String(row.id) : 'newtask.ref';
}

function payloadOf(conn: DbApi): { rows: any[]; defaultId: string } {
  return { rows: readUserRows(conn), defaultId: readDefaultId(conn) };
}

function writePayload(conn: DbApi, payload: { rows: any[]; defaultId: string }, atMs: number): void {
  conn.run(
    `INSERT INTO plugin_legacy_data (plugin_id, kind, payload_json, created_at)
     VALUES (:p, :k, :body, :at)
     ON CONFLICT(plugin_id, kind) DO UPDATE SET payload_json = excluded.payload_json`,
    { p: PLUGIN_ID, k: KIND, body: JSON.stringify(payload), at: atMs },
  );
}

export function stageLegacyTemplates(conn: DbApi, { atMs = Date.now() }: V19Context = {}): {
  rows: number;
  defaultId: string;
} {
  const payload = payloadOf(conn);
  writePayload(conn, payload, atMs);
  conn.run(
    `INSERT INTO plugin_state (plugin_id, enabled, updated_at)
     VALUES (:p, 1, :at)
     ON CONFLICT(plugin_id) DO NOTHING`,
    { p: PLUGIN_ID, at: atMs },
  );
  return { rows: payload.rows.length, defaultId: payload.defaultId };
}
