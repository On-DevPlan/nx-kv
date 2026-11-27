// templates / settings 阶段：legacy templates.json → plugin_legacy_data 暂存；本机设置 → settings。
//
// v20 起 templates 表已删除；旧 JSON 里的内置行不再导入（内置正文由
// packages/plugin-task-template 代码声明），用户行暂存给插件首次激活时消费。
import { CONFIG_PREF_KEYS, jsonText, LOCALTASK_SETTING_KEYS } from './data.js';
import type { ImportReport } from './data.js';
import type { DbApi } from '../driver.js';

const PLUGIN_ID = 'task-template';
const LEGACY_KIND = 'templates';

function readStaged(db: DbApi): { rows: any[]; defaultId: string } {
  const row = db.get(
    'SELECT payload_json FROM plugin_legacy_data WHERE plugin_id = :p AND kind = :k',
    { p: PLUGIN_ID, k: LEGACY_KIND },
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

export function importTemplates(db: DbApi, templatesData: any, atMs: number, report: ImportReport): void {
  const list = Array.isArray(templatesData && templatesData.templates) ? templatesData.templates : [];
  const staged = readStaged(db);
  const byId = new Map<string, any>();
  for (const row of staged.rows) if (row && row.id) byId.set(String(row.id), row);
  list.forEach((t: any, index: number) => {
    if (!t || t.builtin) return; // 内置由插件包接管，不迁
    const id = String(t.id || '').trim();
    if (!id) return;
    byId.set(id, {
      id,
      name: String(t.name || id),
      body: String(t.body || ''),
      vars_schema: jsonText(t.varsSchema ?? []),
      vars: jsonText(t.values && typeof t.values === 'object' ? t.values : {}),
      is_default: 0,
      sort_order: index,
      scope: jsonText(t.scope ?? ['*']),
      origin_topic: String(t.originTopic || ''),
      created_at: Number(t.createdAt) || atMs,
      updated_at: atMs,
      builtin: 0,
      category: 'newtask',
    });
    report.imported.templates += 1;
  });
  const defaultId = String((templatesData && templatesData.defaultId) || '') || staged.defaultId || 'newtask.ref';
  const payload = { rows: [...byId.values()], defaultId };
  db.run(
    `INSERT INTO plugin_legacy_data (plugin_id, kind, payload_json, created_at)
     VALUES (:p, :k, :body, :at)
     ON CONFLICT(plugin_id, kind) DO UPDATE SET payload_json = excluded.payload_json`,
    { p: PLUGIN_ID, k: LEGACY_KIND, body: JSON.stringify(payload), at: atMs },
  );
}

function setSetting(db: DbApi, key: string, value: unknown, atMs: number): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: jsonText(value), at: atMs }
  );
}

export function importSettings(
  db: DbApi,
  localtasksData: any,
  configData: any,
  atMs: number,
  report: ImportReport
): void {
  const lt = (localtasksData && localtasksData.settings) || null;
  if (lt && typeof lt === 'object') {
    for (const k of LOCALTASK_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(lt, k)) continue;
      setSetting(db, 'lt.' + k, lt[k], atMs);
      report.imported.settings += 1;
    }
  }
  if (configData && typeof configData === 'object') {
    // 白名单写入：**只**这四个偏好。token / baseUrl / email / userId / groupId
    // 是凭据与会话身份，绝不允许进库（库会被备份、dump、拷走排障）。
    for (const k of CONFIG_PREF_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(configData, k)) continue;
      setSetting(db, 'app.' + k, configData[k], atMs);
      report.imported.settings += 1;
    }
  }
}
