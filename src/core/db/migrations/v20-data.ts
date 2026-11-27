// v19 → v20 数据迁移：补拷最后一刻的旧用户模板，然后删除 templates 表。
//
// v19 已把当时的用户行写入 plugin_legacy_data；v19 与 v20 之间旧代码理论上还能写
// 新模板，所以这里按模板 id 合并一次，再 drop。插件首次激活时消费 legacy 数据。
import type { DbApi } from '../driver.js';

export interface V20Context {
  atMs?: number;
}

const KIND = 'templates';
const PLUGIN_ID = 'task-template';

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

function readStaged(conn: DbApi): { rows: any[]; defaultId: string } {
  const row = conn.get(
    'SELECT payload_json FROM plugin_legacy_data WHERE plugin_id = :p AND kind = :k',
    { p: PLUGIN_ID, k: KIND },
  );
  if (!row) return { rows: [], defaultId: 'newtask.ref' };
  try {
    const parsed = JSON.parse(String(row.payload_json));
    return {
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
      defaultId: typeof parsed?.defaultId === 'string' ? parsed.defaultId : 'newtask.ref',
    };
  } catch {
    return { rows: [], defaultId: 'newtask.ref' };
  }
}

export function finalizeLegacyTemplates(conn: DbApi, { atMs = Date.now() }: V20Context = {}): {
  rows: number;
  dropped: boolean;
} {
  const has = !!conn.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'");
  const staged = readStaged(conn);
  const byId = new Map<string, any>();
  for (const row of staged.rows) if (row && row.id) byId.set(String(row.id), row);
  for (const row of readUserRows(conn)) if (row && row.id) byId.set(String(row.id), row);
  const defaultId = readDefaultId(conn) || staged.defaultId || 'newtask.ref';
  const payload = { rows: [...byId.values()], defaultId };
  conn.run(
    `INSERT INTO plugin_legacy_data (plugin_id, kind, payload_json, created_at)
     VALUES (:p, :k, :body, :at)
     ON CONFLICT(plugin_id, kind) DO UPDATE SET payload_json = excluded.payload_json`,
    { p: PLUGIN_ID, k: KIND, body: JSON.stringify(payload), at: atMs },
  );
  if (has) conn.exec('DROP TABLE templates');
  return { rows: payload.rows.length, dropped: has };
}
