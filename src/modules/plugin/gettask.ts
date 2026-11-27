// gettask 生命周期点（第二周期点）的宿主实现。
//
// 与 pretask（entries/buildDraft）的分工：
//   - pretask 决定「新任务从哪来」；
//   - gettask 决定「一条已有任务在编辑页底部有哪些插件 tab」+「领取交付时追加哪些插件区块」。
//
// 插件只声明纯数据：条目 id/label/tag/模板/字段/UI 挂载点 + `data(taskCtx)`。
// 宿主负责：
//   ① 声明聚合（全局唯一 id / 标签校验 / 排序）；
//   ② 按任务取块（data() 返回 null = 本条任务不出这段；失败只跳过该插件）；
//   ③ 把「段声明」注册给 promptplug（设置页可编辑出厂模板，装配按用户模板覆盖）。
//
// gettask 的取块必须 fail-open：一个坏插件绝不能把整次领取的 instruction 拖没。
import type {
  NxkvPlugin,
  PluginContext,
  PluginGetTaskEntry,
  PluginGetTaskField,
  PluginTaskInfo,
  PretaskContext,
} from '@nx-kv/plugin-sdk';
import type { FieldDecl } from '../../shared/prompt-plugin.js';
import { registerExternalSegments, type ExternalSegmentDecl } from '../promptplug/external.js';
import { enabledPlugins } from './host.js';

export interface GetTaskQuery extends PretaskContext {
  task?: PluginTaskInfo;
}

/** 声明聚合后的条目（前端 dock / CLI / 设置页共用）。 */
export interface HostGetTaskEntry {
  /** `<pluginId>:<localId>`（与 pretask 入口同形） */
  id: string;
  /** 段 id（`plugin:<pluginId>:<localId>`，模板存储键） */
  segment: string;
  pluginId: string;
  pluginName: string;
  localId: string;
  label: string;
  description: string;
  tag: string;
  /** 设置页展示顺序（全局唯一） */
  order: number;
  /** 出厂模板正文 */
  template: string;
  fields: FieldDecl[];
  ui: { panel: string; title: string } | null;
}

/** 一条任务命中的交付区块（claim 装配用）。 */
export interface GetTaskBlock {
  key: string;
  segment: string;
  pluginId: string;
  label: string;
  tag: string;
  /** 出厂模板正文；用户覆盖在装配时按 segment 读 template-store */
  template: string;
  fields: FieldDecl[];
  data: Record<string, unknown>;
}

const LOCAL_ID_RE = /^[A-Za-z0-9][\w-]*$/;

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

/** 插件声明 → 模板变量目录（自动补任务身份字段：{{task.id}} / {{task.text}}）。 */
export function fieldDeclsOf(fields: readonly PluginGetTaskField[] | undefined): FieldDecl[] {
  const out: FieldDecl[] = [];
  const seen = new Set<string>();
  for (const f of fields || []) {
    const key = String(f?.key || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      kind: f.kind || 'string',
      label: String(f.label || key),
      ...(f.desc ? { desc: String(f.desc) } : {}),
      ...(f.enumValues && f.enumValues.length ? { enumValues: f.enumValues } : {}),
    });
  }
  if (!seen.has('task.id')) out.push({ key: 'task.id', kind: 'number', label: '任务号' });
  if (!seen.has('task.text')) out.push({ key: 'task.text', kind: 'text', label: '任务正文' });
  return out;
}

/** 从宿主任务行构造 gettask 的任务定位（缺字段按空处理）。 */
export function taskInfoOf(
  task: any,
  opts: { topicKey?: string; cwd?: string } = {},
): PluginTaskInfo | null {
  if (!task) return null;
  const id = Number(task.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    text: String(task.text || ''),
    ...(opts.topicKey ? { topicKey: String(opts.topicKey) } : {}),
    ...(opts.cwd ? { cwd: String(opts.cwd) } : {}),
    ...(task.boardKey || task.boardMark ? { boardKey: String(task.boardKey || task.boardMark) } : {}),
    ...(task.repoKey ? { projectKey: String(task.repoKey) } : {}),
    ...(task.status ? { status: String(task.status) } : {}),
  };
}

interface NormalizedEntry {
  entry: PluginGetTaskEntry;
  localId: string;
  tag: string;
  fields: FieldDecl[];
  ui: { panel: string; title: string } | null;
  order: number;
}

/** 单条声明归一化；非法声明返回原因（由调用方记 warning）。 */
function normalizeEntry(
  plugin: NxkvPlugin,
  raw: PluginGetTaskEntry,
): { hit: NormalizedEntry; error: '' } | { hit: null; error: string } {
  if (!raw || typeof raw !== 'object') return { hit: null, error: '条目不是对象' };
  const localId = String(raw.id || '').trim();
  if (!LOCAL_ID_RE.test(localId)) {
    return { hit: null, error: `条目 id 非法「${localId}」（只允许字母/数字/下划线/短横线）` };
  }
  const template = String(raw.template ?? '');
  if (!template.trim()) return { hit: null, error: `条目 ${localId} 的模板为空` };
  const suffix = String(raw.tag || localId).trim();
  const tag = `nxkv.plugin.${plugin.id}.${suffix}`;
  if (!/^[A-Za-z][\w.-]*$/.test(tag)) {
    return { hit: null, error: `条目 ${localId} 的 tag 非法：${tag}` };
  }
  const panel = raw.ui?.panel ? String(raw.ui.panel) : '';
  return {
    hit: {
      entry: raw,
      localId,
      tag,
      fields: fieldDeclsOf(raw.fields),
      ui: panel ? { panel, title: String(raw.ui?.title || raw.label || localId) } : null,
      order: Number(raw.order) || 0,
    },
    error: '',
  };
}

/**
 * 聚合全部已启用插件的 gettask 声明。
 * 声明与具体任务无关（ctx 可以为空）——按任务取数在 collectGetTaskBlocks 里。
 */
export async function listGetTaskEntries(
  query: GetTaskQuery = {},
): Promise<{ entries: HostGetTaskEntry[]; warnings: string[] }> {
  const { task: _task, ...ctx } = query;
  const { handles, warnings } = await enabledPlugins(ctx);
  const collected: (HostGetTaskEntry & { pluginOrder: number; entryOrder: number })[] = [];
  const seen = new Set<string>();
  for (const { plugin, ctx: pluginCtx } of handles) {
    if (typeof plugin.gettask !== 'function') continue;
    let list: PluginGetTaskEntry[] = [];
    try {
      list = await plugin.gettask(pluginCtx);
    } catch (e) {
      warnings.push(`${plugin.id}: gettask 声明失败——${msgOf(e)}`);
      continue;
    }
    for (const raw of Array.isArray(list) ? list : []) {
      const { hit, error } = normalizeEntry(plugin, raw);
      if (!hit) {
        warnings.push(`${plugin.id}: ${error}`);
        continue;
      }
      const key = `${plugin.id}:${hit.localId}`;
      if (seen.has(key)) {
        warnings.push(`${plugin.id}: 条目 ${hit.localId} 重复声明，已忽略后一条`);
        continue;
      }
      seen.add(key);
      collected.push({
        id: `${plugin.id}:${hit.localId}`,
        segment: `plugin:${plugin.id}:${hit.localId}`,
        pluginId: plugin.id,
        pluginName: plugin.name,
        localId: hit.localId,
        label: String(hit.entry.label || hit.localId),
        description: String(hit.entry.description || ''),
        tag: hit.tag,
        order: 0,
        template: String(hit.entry.template || ''),
        fields: hit.fields,
        ui: hit.ui,
        pluginOrder: Number(plugin.order) || 100,
        entryOrder: hit.order,
      });
    }
  }
  collected.sort(
    (a, b) =>
      a.pluginOrder - b.pluginOrder ||
      a.entryOrder - b.entryOrder ||
      a.id.localeCompare(b.id),
  );
  const entries = collected.map((e, i) => {
    const { pluginOrder: _p, entryOrder: _e, ...rest } = e;
    return { ...rest, order: i + 1 };
  });
  return { entries, warnings };
}

/**
 * 按一条确定的任务收集交付区块：调用每个条目的 data(taskCtx)。
 * data 返回 null / undefined = 本条任务不出这段；单个插件失败只记 warning。
 */
export async function collectGetTaskBlocks(
  task: PluginTaskInfo,
  ctx: PretaskContext = {},
): Promise<{ blocks: GetTaskBlock[]; warnings: string[] }> {
  const blocks: GetTaskBlock[] = [];
  const warnings: string[] = [];
  if (!task || !Number(task.id)) return { blocks, warnings };
  const { handles, warnings: activationWarnings } = await enabledPlugins({
    ...ctx,
    ...(task.topicKey ? { topicKey: task.topicKey } : {}),
    // 组任务：任务落库时带 repoKey（projectKey）——插件据此解析「在哪个仓库执行」。
    ...(task.projectKey ? { repoKey: task.projectKey } : {}),
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(ctx.location?.taskId ? {} : { location: { ...(ctx.location || {}), taskId: String(task.id) } }),
  });
  warnings.push(...activationWarnings);
  const seen = new Set<string>();
  for (const { plugin, ctx: pluginCtx } of handles) {
    if (typeof plugin.gettask !== 'function') continue;
    let list: PluginGetTaskEntry[] = [];
    try {
      list = await plugin.gettask(pluginCtx);
    } catch (e) {
      warnings.push(`${plugin.id}: gettask 声明失败——${msgOf(e)}`);
      continue;
    }
    for (const raw of Array.isArray(list) ? list : []) {
      const { hit, error } = normalizeEntry(plugin, raw);
      if (!hit) {
        warnings.push(`${plugin.id}: ${error}`);
        continue;
      }
      if (seen.has(`${plugin.id}:${hit.localId}`)) {
        warnings.push(`${plugin.id}: 条目 ${hit.localId} 重复声明，已忽略后一条`);
        continue;
      }
      seen.add(`${plugin.id}:${hit.localId}`);
      if (typeof hit.entry.data !== 'function') {
        warnings.push(`${plugin.id}: 条目 ${hit.localId} 缺少 data()，跳过`);
        continue;
      }
      try {
        const data = await hit.entry.data({ ...(pluginCtx as PluginContext), task });
        if (data === null || data === undefined) continue;
        if (typeof data !== 'object' || Array.isArray(data)) {
          warnings.push(`${plugin.id}: 条目 ${hit.localId} 的 data() 必须返回对象或 null`);
          continue;
        }
        blocks.push({
          key: `${plugin.id}:${hit.localId}`,
          segment: `plugin:${plugin.id}:${hit.localId}`,
          pluginId: plugin.id,
          label: String(hit.entry.label || hit.localId),
          tag: hit.tag,
          template: String(hit.entry.template || ''),
          fields: hit.fields,
          data: data as Record<string, unknown>,
        });
      } catch (e) {
        warnings.push(`${plugin.id}: 条目 ${hit.localId} 取数失败（本条任务跳过该区块）——${msgOf(e)}`);
      }
    }
  }
  return { blocks, warnings };
}

// ── 把声明注册给 promptplug（设置页注册表 / 模板保存校验读这里）────────────
// 注册动作在模块加载时发生；插件宿主被任何入口 import 一次即生效。
registerExternalSegments(async (): Promise<ExternalSegmentDecl[]> => {
  const { entries } = await listGetTaskEntries({});
  return entries.map((e) => ({
    id: e.segment,
    group: 'gettask',
    order: e.order,
    tag: e.tag,
    label: e.label,
    description: e.description,
    template: e.template,
    fields: e.fields,
  }));
});
