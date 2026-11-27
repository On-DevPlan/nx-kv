// 任务模板插件的业务存储：模板行 + 默认入口设置。
import crypto from 'node:crypto';
import type { PluginDb, PretaskContext, SlotDecl } from '@nx-kv/plugin-sdk';
import { templateSlots } from '@nx-kv/plugin-sdk/template';
import { NEWTASK_REF_BODY } from './builtin-body.js';
import { canUse, normalizeScope } from './scope.js';

export const PLUGIN_ID = 'task-template';
export const BUILTIN_LOCAL_ID = 'ref';
export const BUILTIN_ENTRY_ID = `${PLUGIN_ID}:${BUILTIN_LOCAL_ID}`;
const DEFAULT_SETTING_KEY = 'default_entry';

export interface TemplateRow {
  id: string;
  name: string;
  body: string;
  vars_schema: string;
  vars: string;
  sort_order: number;
  scope: string;
  origin_topic: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TemplateView {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
  default: boolean;
  scope: string[];
  vars: Record<string, string>;
  sortOrder: number;
  slots: SlotDecl[];
  createdAt: number;
  updatedAt: number;
}

const at = (): number => Date.now();

function parseObject(raw: unknown): Record<string, string> {
  try {
    const value = JSON.parse(String(raw ?? '{}'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) out[String(k)] = String(v ?? '');
    return out;
  } catch {
    return {};
  }
}

function parseScope(raw: unknown): string[] {
  return normalizeScope(raw);
}

/** 供 entries 展示模板默认槽位值。 */
export function varsOfRow(raw: unknown): Record<string, string> {
  return parseObject(raw);
}

function slotsOf(body: string): SlotDecl[] {
  return templateSlots(body).map((key) => ({ key, label: key, type: 'text' as const }));
}

export function entryIdOf(localId: string): string {
  return `${PLUGIN_ID}:${localId}`;
}

export function localIdOf(entryId: unknown): string {
  const s = String(entryId || '');
  return s.startsWith(`${PLUGIN_ID}:`) ? s.slice(PLUGIN_ID.length + 1) : s;
}

function getSetting(db: PluginDb, key: string): string {
  const row = db.get('SELECT value_json FROM plugin_task_template_settings WHERE key = :k', { k: key });
  if (!row) return '';
  try {
    const value = JSON.parse(String(row.value_json));
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function setSetting(db: PluginDb, key: string, value: string): void {
  db.run(
    `INSERT INTO plugin_task_template_settings (key, value_json, updated_at)
     VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    { k: key, v: JSON.stringify(value), at: at() },
  );
}

export function listRows(db: PluginDb): TemplateRow[] {
  return db.all(
    `SELECT id, name, body, vars_schema, vars, sort_order, scope, origin_topic,
            created_at, updated_at, deleted_at
       FROM plugin_task_templates
      WHERE deleted_at IS NULL
      ORDER BY sort_order, id`,
  ) as TemplateRow[];
}

export function getRow(db: PluginDb, localId: string): TemplateRow | null {
  const row = db.get(
    `SELECT id, name, body, vars_schema, vars, sort_order, scope, origin_topic,
            created_at, updated_at, deleted_at
       FROM plugin_task_templates WHERE id = :id AND deleted_at IS NULL`,
    { id: localId },
  );
  return (row as TemplateRow) || null;
}

export function getDefaultEntryId(db: PluginDb): string {
  const stored = getSetting(db, DEFAULT_SETTING_KEY);
  if (stored === BUILTIN_ENTRY_ID) return stored;
  const local = localIdOf(stored);
  if (stored && local && getRow(db, local)) return stored;
  return BUILTIN_ENTRY_ID;
}

export function setDefaultEntry(db: PluginDb, entryId: string): void {
  const local = localIdOf(entryId);
  if (local !== BUILTIN_LOCAL_ID && !getRow(db, local)) throw new Error(`模板不存在：${entryId}`);
  setSetting(db, DEFAULT_SETTING_KEY, entryId);
}

function viewOf(row: TemplateRow, defaultEntryId: string): TemplateView {
  return {
    id: entryIdOf(row.id),
    name: row.name,
    body: row.body,
    builtin: false,
    default: entryIdOf(row.id) === defaultEntryId,
    scope: parseScope(row.scope),
    vars: parseObject(row.vars),
    sortOrder: Number(row.sort_order) || 0,
    slots: slotsOf(row.body),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function builtinView(defaultEntryId: string): TemplateView {
  return {
    id: BUILTIN_ENTRY_ID,
    name: 'ref 生成',
    body: NEWTASK_REF_BODY,
    builtin: true,
    default: defaultEntryId === BUILTIN_ENTRY_ID,
    scope: ['*'],
    vars: {},
    sortOrder: 0,
    slots: slotsOf(NEWTASK_REF_BODY),
    createdAt: 0,
    updatedAt: 0,
  };
}

export function listTemplates(db: PluginDb): { defaultId: string; templates: TemplateView[] } {
  const defaultId = getDefaultEntryId(db);
  return {
    defaultId,
    templates: [builtinView(defaultId), ...listRows(db).map((r) => viewOf(r, defaultId))],
  };
}

export function addTemplate(
  db: PluginDb,
  input: { name?: unknown; body?: unknown; scope?: unknown; topic?: unknown },
): TemplateView {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('需要模板名');
  const body = String(input.body ?? '').trim() ? String(input.body) : NEWTASK_REF_BODY;
  const topic = String(input.topic || '').trim();
  const scope = input.scope !== undefined
    ? normalizeScope(input.scope)
    : topic
      ? [`topic:${topic}`]
      : ['*'];
  const now = at();
  const id = `t_${crypto.randomBytes(5).toString('hex')}`;
  const sortRow = db.get('SELECT MAX(sort_order) AS m FROM plugin_task_templates WHERE deleted_at IS NULL');
  const sort = (sortRow && sortRow.m !== null && sortRow.m !== undefined ? Number(sortRow.m) : -1) + 1;
  db.run(
    `INSERT INTO plugin_task_templates
       (id, name, body, vars_schema, vars, sort_order, scope, origin_topic, created_at, updated_at, deleted_at)
     VALUES (:id, :name, :body, '[]', '{}', :sort, :scope, :origin, :at, :at, NULL)`,
    { id, name: name.slice(0, 60), body, sort, scope: JSON.stringify(scope), origin: topic, at: now },
  );
  const row = getRow(db, id);
  if (!row) throw new Error('模板写入失败');
  return viewOf(row, getDefaultEntryId(db));
}

export function updateTemplate(
  db: PluginDb,
  input: { id?: unknown; name?: unknown; body?: unknown; scope?: unknown },
): TemplateView {
  const local = localIdOf(input.id);
  if (local === BUILTIN_LOCAL_ID) throw new Error('内置模板不可修改');
  const row = local ? getRow(db, local) : null;
  if (!row) throw new Error(`模板不存在：${String(input.id)}`);
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: local, at: at() };
  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('模板名不能为空');
    sets.push('name = :name');
    params.name = name.slice(0, 60);
  }
  if (input.body !== undefined) {
    sets.push('body = :body');
    params.body = String(input.body ?? '');
  }
  if (input.scope !== undefined) {
    sets.push('scope = :scope');
    params.scope = JSON.stringify(normalizeScope(input.scope));
  }
  if (sets.length) {
    sets.push('updated_at = :at');
    db.run(`UPDATE plugin_task_templates SET ${sets.join(', ')} WHERE id = :id`, params);
  }
  const next = getRow(db, local);
  if (!next) throw new Error('模板更新后读不到');
  return viewOf(next, getDefaultEntryId(db));
}

export function removeTemplate(db: PluginDb, id: unknown): { removed: string; defaultId: string } {
  const local = localIdOf(id);
  if (local === BUILTIN_LOCAL_ID) throw new Error('内置模板不可删除');
  const row = local ? getRow(db, local) : null;
  if (!row) throw new Error(`模板不存在：${String(id)}`);
  db.run('DELETE FROM plugin_task_templates WHERE id = :id', { id: local });
  if (getDefaultEntryId(db) === entryIdOf(local)) setSetting(db, DEFAULT_SETTING_KEY, BUILTIN_ENTRY_ID);
  return { removed: entryIdOf(local), defaultId: getDefaultEntryId(db) };
}

export function reorderTemplates(db: PluginDb, ids: unknown): TemplateView[] {
  const list = Array.isArray(ids) ? ids.map((x) => localIdOf(x)).filter(Boolean) : [];
  if (!list.length) throw new Error('需要 ids（模板入口 id 的有序数组）');
  const now = at();
  list.forEach((local, index) => {
    if (local === BUILTIN_LOCAL_ID) return;
    db.run('UPDATE plugin_task_templates SET sort_order = :sort, updated_at = :at WHERE id = :id', {
      sort: index + 1,
      at: now,
      id: local,
    });
  });
  return listTemplates(db).templates;
}

/** 宿主 v19/v20 暂存的旧用户模板：按旧 id 幂等导入。 */
export function importLegacy(db: PluginDb, payload: unknown): number {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, any>) : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  let imported = 0;
  for (const raw of rows) {
    if (!raw || !raw.id) continue;
    const id = String(raw.id);
    const now = at();
    db.run(
      `INSERT INTO plugin_task_templates
         (id, name, body, vars_schema, vars, sort_order, scope, origin_topic, created_at, updated_at, deleted_at)
       VALUES (:id, :name, :body, :schema, :vars, :sort, :scope, :origin, :created, :updated, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         body = excluded.body,
         vars_schema = excluded.vars_schema,
         vars = excluded.vars,
         sort_order = excluded.sort_order,
         scope = excluded.scope,
         origin_topic = excluded.origin_topic,
         updated_at = excluded.updated_at`,
      {
        id,
        name: String(raw.name || id).slice(0, 60),
        body: String(raw.body || ''),
        schema: typeof raw.vars_schema === 'string' ? raw.vars_schema : JSON.stringify(raw.vars_schema ?? []),
        vars: typeof raw.vars === 'string' ? raw.vars : JSON.stringify(raw.vars ?? {}),
        sort: Number(raw.sort_order) || 0,
        scope: typeof raw.scope === 'string' ? raw.scope : JSON.stringify(raw.scope ?? ['*']),
        origin: String(raw.origin_topic || ''),
        created: Number(raw.created_at) || now,
        updated: Number(raw.updated_at) || now,
      },
    );
    imported += 1;
  }
  const wanted = String(data.defaultId || '');
  const local = localIdOf(wanted);
  if (wanted && local && local !== BUILTIN_LOCAL_ID && getRow(db, local)) {
    setSetting(db, DEFAULT_SETTING_KEY, entryIdOf(local));
  } else if (!getSetting(db, DEFAULT_SETTING_KEY)) {
    setSetting(db, DEFAULT_SETTING_KEY, BUILTIN_ENTRY_ID);
  }
  return imported;
}

export function rowsForEntries(db: PluginDb, ctx: PretaskContext): TemplateRow[] {
  return listRows(db).filter((row) => canUse(parseScope(row.scope), ctx));
}

export function templateOfEntry(db: PluginDb, entryId: string): { row: TemplateRow | null; body: string } | null {
  const local = localIdOf(entryId);
  if (local === BUILTIN_LOCAL_ID) return { row: null, body: NEWTASK_REF_BODY };
  const row = getRow(db, local);
  return row ? { row, body: row.body } : null;
}

export function slotsOfBody(body: string): SlotDecl[] {
  return slotsOf(body);
}
