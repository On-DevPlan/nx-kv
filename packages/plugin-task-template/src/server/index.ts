// task-template 插件 server 入口：下拉入口、槽位草稿、模板 CRUD RPC、存储迁移与旧数据导入。
import { definePlugin, paramsOf } from '@nx-kv/plugin-sdk';
import type { EntryView, PluginContext, PretaskDraft } from '@nx-kv/plugin-sdk';
import { renderTemplateBody } from '@nx-kv/plugin-sdk/template';
import { NEWTASK_REF_BODY } from './builtin-body.js';
import { migrateStorage, STORAGE_VERSION } from './storage.js';
import {
  BUILTIN_ENTRY_ID,
  PLUGIN_ID,
  addTemplate as addTemplateRow,
  entryIdOf,
  getDefaultEntryId,
  importLegacy,
  listTemplates,
  removeTemplate,
  reorderTemplates,
  rowsForEntries,
  setDefaultEntry,
  slotsOfBody,
  templateOfEntry,
  updateTemplate,
  varsOfRow,
} from './templates.js';

function summaryOf(body: string): string {
  return String(body || '')
    .split('\n')
    .map((line) => line.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, ''))
    .find(Boolean)
    ?.slice(0, 60) || '';
}

function draftEntry(input: {
  entryId: string;
  label: string;
  description?: string;
  body: string;
  values: Record<string, string>;
  order: number;
  isDefault: boolean;
  builtin: boolean;
}): EntryView {
  const slots = slotsOfBody(input.body);
  return {
    id: input.entryId,
    pluginId: PLUGIN_ID,
    label: input.label,
    description: input.description,
    icon: 'list',
    kind: 'draft',
    order: input.order,
    default: input.isDefault,
    builtin: input.builtin,
    previewBody: input.body,
    slots,
    values: input.values,
    ui: { row: 'entry-row', ...(slots.length ? { form: 'entry-form' } : {}) },
  };
}

export default definePlugin({
  id: PLUGIN_ID,
  version: '0.1.0',
  api: '^1',
  name: '任务模板',
  description: '新建任务时的正文模板与槽位填写；内置 ref 生成 + 用户模板。',
  order: 10,
  defaultEnabled: true,
  storageVersion: STORAGE_VERSION,
  migrateStorage,
  async migrateLegacy(ctx, kind, payload) {
    if (kind === 'templates') importLegacy(ctx.storage, payload);
  },
  entries(ctx: PluginContext) {
    const defaultId = getDefaultEntryId(ctx.storage);
    const out: EntryView[] = [
      draftEntry({
        entryId: BUILTIN_ENTRY_ID,
        label: 'ref 生成',
        description: '零知识起步：先摸仓库，再归档成一篇 ref',
        body: NEWTASK_REF_BODY,
        values: {},
        order: 0,
        isDefault: defaultId === BUILTIN_ENTRY_ID,
        builtin: true,
      }),
    ];
    for (const row of rowsForEntries(ctx.storage, ctx)) {
      const entryId = entryIdOf(row.id);
      out.push(
        draftEntry({
          entryId,
          label: row.name,
          description: summaryOf(row.body),
          body: row.body,
          values: varsOfRow(row.vars),
          order: Number(row.sort_order) + 1,
          isDefault: defaultId === entryId,
          builtin: false,
        }),
      );
    }
    // 管理页不再进「新建页」下拉：它是插件自管理页，入口在左下角侧栏（插件自注册）。
    return out;
  },
  async buildDraft(ctx, entryId, values): Promise<PretaskDraft> {
    const hit = templateOfEntry(ctx.storage, entryId);
    if (!hit) throw new Error(`模板不存在：${entryId}`);
    return { body: renderTemplateBody(hit.body, values) };
  },
  rpc: {
    async listTemplates(ctx) {
      return listTemplates(ctx.storage);
    },
    async addTemplate(ctx, raw) {
      const params = paramsOf(raw);
      const template = addTemplateRow(ctx.storage, params);
      return { template, ...listTemplates(ctx.storage) };
    },
    async updateTemplate(ctx, raw) {
      const params = paramsOf(raw);
      const template = updateTemplate(ctx.storage, params);
      return { template, ...listTemplates(ctx.storage) };
    },
    async removeTemplate(ctx, raw) {
      const params = paramsOf(raw);
      const result = removeTemplate(ctx.storage, params.id);
      return { ...result, ...listTemplates(ctx.storage) };
    },
    async setDefault(ctx, raw) {
      const params = paramsOf(raw);
      setDefaultEntry(ctx.storage, String(params.id || ''));
      return listTemplates(ctx.storage);
    },
    async reorder(ctx, raw) {
      const params = paramsOf(raw);
      reorderTemplates(ctx.storage, params.ids);
      return listTemplates(ctx.storage);
    },
  },
});
