// 插件宿主：加载包、激活（存储迁移 + legacy 导入）、入口汇总/可见性、草稿与 RPC 分派。
//
// 边界：宿主只认识 @nx-kv/plugin-sdk 的契约；插件的表结构/业务 SQL 全在插件包里。
// v1 同进程可信插件；单插件失败只跳过它，不拖垮其他插件或任务草稿。
import type {
  EntryView,
  NxkvPlugin,
  PluginContext,
  PretaskContext,
  PretaskDraft,
} from '@nx-kv/plugin-sdk';
import { renderTemplateBody } from './template.js';
import { badInput, notFound } from '../../core/errors.js';
import { db } from './repo/db.js';
import { allState, setState, stateOf } from './repo/state.js';
import {
  defaultOfScope,
  rowsOfScope,
  setDefault as setScopeDefault,
  setScope,
  type VisibilityRow,
} from './repo/visibility.js';
import { deleteLegacy, getLegacy, legacyKinds } from './repo/legacy.js';
import { setVersion, versionOf } from './repo/migrations.js';
import { loadPlugins, type LoadedPlugin } from './registry.js';
import { resolvePluginContext } from './context.js';

export interface PluginSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  api: string;
  order: number;
  enabled: boolean;
  entryCount: number;
  clientUrl: string;
  styleUrl: string;
  error: string;
}

export interface HostEntry extends EntryView {
  pluginName?: string;
  visible: boolean;
  sortOrder: number;
}

export interface EntriesQuery extends PretaskContext {
  all?: boolean;
}

export interface EntriesResult {
  entries: HostEntry[];
  defaultEntryId: string;
  warnings: string[];
}

export interface DraftQuery extends PretaskContext {
  entryId: string;
  values?: Record<string, string>;
}

export interface VisibilityView {
  scopeKey: string;
  entries: VisibilityRow[];
  /** 本 scope 配的「新建页」默认入口；'' = 跟随插件声明。 */
  defaultEntryId: string;
}

const activated = new Set<string>();
const activationErrors = new Map<string, string>();
let activatedForDb = '';

/** 测试 / env 换库时清激活态：插件表属于具体 DB，不能跨库复用。 */
function ensureDbScope(): void {
  const path = db().path;
  if (path === activatedForDb) return;
  activatedForDb = path;
  activated.clear();
  activationErrors.clear();
}

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

function stateMap(): Map<string, boolean> {
  return new Map(allState().map((s) => [s.pluginId, s.enabled]));
}

function isEnabled(plugin: NxkvPlugin, states: Map<string, boolean>): boolean {
  return states.has(plugin.id) ? !!states.get(plugin.id) : !!plugin.defaultEnabled;
}

function contextOf(plugin: NxkvPlugin, ctx: PretaskContext): PluginContext {
  return {
    ...resolvePluginContext(ctx || {}),
    storage: db(),
    storageVersion: versionOf(plugin.id),
    log: (level, message) => {
      const line = `[plugin:${plugin.id}] ${level}: ${message}`;
      if (level === 'warn' || level === 'error') console.warn(line);
      else console.log(line);
    },
    legacy: {
      take: async (kind: string) => getLegacy(plugin.id, kind),
    },
  };
}

/** 激活一次：插件自己的表结构迁移 + 宿主暂存 legacy 数据导入。 */
async function ensureActivated(loaded: LoadedPlugin): Promise<string> {
  const plugin = loaded.plugin;
  if (!plugin) return loaded.error || '插件未加载';
  if (activated.has(plugin.id)) return activationErrors.get(plugin.id) || '';
  try {
    const conn = db();
    const from = versionOf(plugin.id);
    const migrated = plugin.migrateStorage?.(conn, from);
    const target = typeof migrated === 'number' ? migrated : Number(plugin.storageVersion) || from;
    if (target !== from) setVersion(plugin.id, target);

    for (const kind of legacyKinds(plugin.id)) {
      const payload = getLegacy(plugin.id, kind);
      if (payload === null) continue;
      if (!plugin.migrateLegacy) {
        contextOf(plugin, {}).log('warn', `有 legacy 数据 ${kind}，但插件未实现 migrateLegacy`);
        continue;
      }
      await plugin.migrateLegacy(contextOf(plugin, {}), kind, payload);
      deleteLegacy(plugin.id, kind);
    }
    activated.add(plugin.id);
    activationErrors.delete(plugin.id);
    return '';
  } catch (e) {
    const message = msgOf(e);
    activationErrors.set(plugin.id, message);
    return message;
  }
}

export function resetActivation(): void {
  activated.clear();
  activationErrors.clear();
}

/** 一个已启用且激活成功的插件 + 它看到的上下文（gettask 等生命周期点共用）。 */
export interface EnabledPluginHandle {
  plugin: NxkvPlugin;
  ctx: PluginContext;
}

/**
 * 列出「已启用 + 激活成功」的插件并逐个构造上下文。
 * 激活失败 / 未启用的插件只记 warning，不阻断调用方（gettask 取块必须 fail-open）。
 */
export async function enabledPlugins(
  ctx: PretaskContext = {},
): Promise<{ handles: EnabledPluginHandle[]; warnings: string[] }> {
  ensureDbScope();
  const loaded = await loadPlugins();
  const states = stateMap();
  const warnings: string[] = [];
  const handles: EnabledPluginHandle[] = [];
  for (const l of loaded) {
    const plugin = l.plugin;
    if (!plugin || !isEnabled(plugin, states)) continue;
    const error = await ensureActivated(l);
    if (error) {
      warnings.push(`${plugin.id}: ${error}`);
      continue;
    }
    handles.push({ plugin, ctx: contextOf(plugin, ctx) });
  }
  return { handles, warnings };
}

/** 全局插件清单（设置页用）：包含加载失败与未启用的插件。 */
export async function listPlugins(): Promise<PluginSummary[]> {
  ensureDbScope();
  const loaded = await loadPlugins();
  const states = stateMap();
  const out: PluginSummary[] = [];
  for (const l of loaded) {
    const plugin = l.plugin;
    if (!plugin) {
      out.push({
        id: l.info.packageName,
        name: l.info.packageName,
        description: '',
        version: '',
        api: l.info.api,
        order: 1000,
        enabled: false,
        entryCount: 0,
        clientUrl: '',
        styleUrl: '',
        error: l.error,
      });
      continue;
    }
    const enabled = isEnabled(plugin, states);
    let entryCount = 0;
    let error = '';
    if (enabled) {
      error = await ensureActivated(l);
      if (!error) {
        try {
          const list = await plugin.entries(contextOf(plugin, {}));
          entryCount = Array.isArray(list) ? list.length : 0;
        } catch (e) {
          error = msgOf(e);
        }
      }
    }
    out.push({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description || '',
      version: plugin.version,
      api: plugin.api,
      order: Number(plugin.order) || 100,
      enabled,
      entryCount,
      clientUrl: l.info.client ? `/plugins/${encodeURIComponent(plugin.id)}/client.js` : '',
      styleUrl: l.info.style ? `/plugins/${encodeURIComponent(plugin.id)}/style.css` : '',
      error,
    });
  }
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return out;
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginSummary[]> {
  ensureDbScope();
  const loaded = await loadPlugins();
  const hit = loaded.find((l) => l.plugin?.id === pluginId);
  if (!hit?.plugin) throw notFound(`没有插件 ${pluginId}`);
  setState(pluginId, !!enabled);
  if (enabled) {
    activated.delete(pluginId);
    activationErrors.delete(pluginId);
  }
  return listPlugins();
}

export function scopeKeyOf(ctx: PretaskContext): string {
  if (ctx.topicKey) return `topic:${ctx.topicKey}`;
  if (ctx.repoKey) return `repo:${ctx.repoKey}`;
  if (ctx.groupKey) return `group:${ctx.groupKey}`;
  return '';
}

export function isScopeKey(value: string): boolean {
  return /^(topic|repo|group):.+/.test(String(value || ''));
}

/** 入口列表：只返回已启用插件；all=false 时按当前 scope 过滤隐藏项。 */
export async function listEntries(query: EntriesQuery = {}): Promise<EntriesResult> {
  ensureDbScope();
  const loaded = await loadPlugins();
  const states = stateMap();
  const { all = false, ...ctx } = query;
  const scopeKey = scopeKeyOf(ctx);
  const vis = new Map(rowsOfScope(scopeKey).map((r) => [r.entryId, r]));
  const pluginOrder = new Map(loaded.filter((l) => l.plugin).map((l) => [l.plugin!.id, Number(l.plugin!.order) || 100]));
  const warnings: string[] = [];
  const collected: HostEntry[] = [];

  for (const l of loaded) {
    const plugin = l.plugin;
    if (!plugin || !isEnabled(plugin, states)) continue;
    const error = await ensureActivated(l);
    if (error) {
      warnings.push(`${plugin.id}: ${error}`);
      continue;
    }
    let list: EntryView[] = [];
    try {
      list = await plugin.entries(contextOf(plugin, ctx));
    } catch (e) {
      warnings.push(`${plugin.id}: ${msgOf(e)}`);
      continue;
    }
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.id || !String(entry.id).startsWith(`${plugin.id}:`)) {
        warnings.push(`${plugin.id}: 入口 id 非法（应为 ${plugin.id}:...）：${String(entry.id)}`);
        continue;
      }
      if (entry.kind !== 'draft' && entry.kind !== 'panel') {
        warnings.push(`${plugin.id}: 入口 ${entry.id} 的 kind 非法`);
        continue;
      }
      const row = vis.get(entry.id);
      const visible = row ? row.visible : true;
      if (!all && !visible) continue;
      collected.push({
        ...entry,
        pluginId: plugin.id,
        pluginName: plugin.name,
        visible,
        sortOrder: row ? row.sortOrder : Number(entry.order) || 0,
      });
    }
  }

  collected.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (pluginOrder.get(a.pluginId) || 100) - (pluginOrder.get(b.pluginId) || 100) ||
      (Number(a.order) || 0) - (Number(b.order) || 0) ||
      a.id.localeCompare(b.id),
  );
  const visibleList = collected.filter((e) => e.visible);
  // 默认入口：本 scope 显式配置 > 插件声明的 default > 首个草稿入口 > 第一个可见入口。
  // 配置项可能被隐藏：只在可见集合里生效（配了但不撤销，重新勾选可见即恢复）。
  const scopeDefault = defaultOfScope(scopeKey);
  const preferred =
    visibleList.find((e) => e.id === scopeDefault) ||
    visibleList.find((e) => e.kind === 'draft' && e.default) ||
    visibleList.find((e) => e.kind === 'draft') ||
    visibleList[0];
  return { entries: collected, defaultEntryId: preferred?.id || '', warnings };
}

function visibilityView(scopeKey: string): VisibilityView {
  return { scopeKey, entries: rowsOfScope(scopeKey), defaultEntryId: defaultOfScope(scopeKey) };
}

export async function getVisibility(scopeKey: string): Promise<VisibilityView> {
  ensureDbScope();
  if (!isScopeKey(scopeKey)) throw badInput(`非法 scopeKey：${scopeKey}（应为 topic:/repo:/group:）`);
  return visibilityView(scopeKey);
}

/** 设某个 scope 的「新建页」默认入口；entryId 为空 = 跟随插件默认。 */
export async function setDefaultEntry(scopeKey: string, entryId: string): Promise<VisibilityView> {
  ensureDbScope();
  if (!isScopeKey(scopeKey)) throw badInput(`非法 scopeKey：${scopeKey}（应为 topic:/repo:/group:）`);
  const id = String(entryId || '').trim();
  if (id && !id.includes(':')) throw badInput(`非法入口 id：${id}（应形如 task-template:ref）`);
  setScopeDefault(scopeKey, id);
  return visibilityView(scopeKey);
}

export async function setVisibility(
  scopeKey: string,
  entries: readonly { entryId: string; visible: boolean; sortOrder?: number }[],
): Promise<VisibilityView> {
  ensureDbScope();
  if (!isScopeKey(scopeKey)) throw badInput(`非法 scopeKey：${scopeKey}（应为 topic:/repo:/group:）`);
  for (const e of entries) {
    if (!e || typeof e.entryId !== 'string' || !e.entryId.includes(':')) {
      throw badInput(`非法入口 id：${String(e && e.entryId)}`);
    }
  }
  setScope(scopeKey, entries);
  return visibilityView(scopeKey);
}

/** 生成 pretask 草稿。入口必须属于已启用插件且在当前 scope 可见。 */
export async function buildDraft(query: DraftQuery): Promise<PretaskDraft> {
  ensureDbScope();
  const entryId = String(query.entryId || '').trim();
  if (!entryId.includes(':')) throw badInput('需要 entryId（形如 task-template:ref）');
  const pluginId = entryId.slice(0, entryId.indexOf(':'));
  const loaded = await loadPlugins();
  const hit = loaded.find((l) => l.plugin?.id === pluginId);
  if (!hit?.plugin) throw notFound(`没有插件 ${pluginId}`);
  const states = stateMap();
  if (!isEnabled(hit.plugin, states)) throw badInput(`插件 ${pluginId} 已禁用`);
  const error = await ensureActivated(hit);
  if (error) throw new Error(`插件 ${pluginId} 激活失败：${error}`);

  const { entryId: _e, values, ...ctx } = query;
  const list = await hit.plugin.entries(contextOf(hit.plugin, ctx));
  const entry = (Array.isArray(list) ? list : []).find((e) => e.id === entryId);
  if (!entry) throw notFound(`入口不存在或当前主题不可见：${entryId}`);
  if (entry.kind === 'panel') throw badInput(`入口 ${entryId} 是面板入口，不能生成草稿`);

  try {
    const draft = await hit.plugin.buildDraft(contextOf(hit.plugin, ctx), entryId, values || {});
    const body = String((draft && draft.body) || '');
    if (!body.trim()) throw new Error('插件返回了空草稿');
    return { body, ...(draft && draft.title ? { title: String(draft.title) } : {}) };
  } catch (e) {
    if (entry.previewBody) {
      const body = renderTemplateBody(entry.previewBody, values);
      if (body.trim()) return { body };
    }
    throw e;
  }
}

/** 插件自有 RPC（插件管理页面/目录批注页用）。ctx 由宿主页面透传，宿主负责补全。 */
export async function callRpc(
  pluginId: string,
  method: string,
  params?: unknown,
  ctx: PretaskContext = {},
): Promise<unknown> {
  ensureDbScope();
  if (!/^[A-Za-z][\w]*$/.test(String(method || ''))) throw badInput(`非法 RPC 方法：${String(method)}`);
  const loaded = await loadPlugins();
  const hit = loaded.find((l) => l.plugin?.id === pluginId);
  if (!hit?.plugin) throw notFound(`没有插件 ${pluginId}`);
  const states = stateMap();
  if (!isEnabled(hit.plugin, states)) throw badInput(`插件 ${pluginId} 已禁用`);
  const error = await ensureActivated(hit);
  if (error) throw new Error(`插件 ${pluginId} 激活失败：${error}`);
  const fn = hit.plugin.rpc?.[method];
  if (typeof fn !== 'function') throw notFound(`插件 ${pluginId} 没有 RPC 方法 ${method}`);
  return fn(contextOf(hit.plugin, ctx), params);
}

/** 当前插件是否启用（其他宿主模块可查）。 */
export async function pluginEnabled(pluginId: string): Promise<boolean> {
  const loaded = await loadPlugins();
  const plugin = loaded.find((l) => l.plugin?.id === pluginId)?.plugin;
  if (!plugin) return false;
  return stateOf(pluginId) ?? !!plugin.defaultEnabled;
}

export { loadPlugins } from './registry.js';
export type { LoadedPlugin } from './registry.js';
