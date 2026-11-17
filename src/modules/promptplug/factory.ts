// promptplug 插件工厂：按**时机链**构造插件 + 字段目录 + 白名单数据源（#152）。
//
// 单独成文件的原因：actions/ 下的 action 经 _manifest.generated.ts 被 index.ts
// 装配，若 action 反向 import index.js 就形成 TDZ 回环——工厂是 actions 与
// tasktool 共同的依赖终点，不含任何装配代码。
//
// 依赖方向（设计内）：tasktool 是唯一消费方——领域取数（readGroupContext /
// attachTemplateCtx / pendingQueueInfo / getloop 指令渲染）由宿主完成，以 `Supply`
// 形式交给插件；插件在自己的 buildData() 里 await supplied() 后只做变换。
// promptplug 不 import 其他模块。
//
// #152 起模板不再注入：每个插件类的 `templates` 就是它的正文，构造只传 overrides（预览/测试用）。
import type { AnyPromptPlugin } from '../../shared/prompt-plugin.js';
import type { PluginGroup, Supply } from './base.js';
import { ContextPlugin } from './plugins/context.js';
import { AttachmentPlugin } from './plugins/attachment.js';
import { ExtPlugin } from './plugins/ext.js';
import { GetloopPlugin } from './plugins/getloop.js';
import { AckPlugin, DoneguardPlugin, GoalhintPlugin, TimecheckPlugin } from './plugins/readonly-blocks.js';
import { allPluginIds, groupPluginIds, pluginMeta } from './registry.js';

/** 交付插件构造所需的宿主取数（值或惰性函数；异步留给 HTTP 类取数）。 */
export interface DeliveryPluginDeps {
  groupCtx: Supply<unknown>;
  attach: Supply<unknown>;
  queueInfo: Supply<{ topic: string; count: number; list: { id: number; title: string }[] } | null>;
  loopText: Supply<string>;
  waitMinutes: Supply<number>;
}

/** 空 deps（只出声明面 / 预览占位时用）。 */
export const EMPTY_DEPS: DeliveryPluginDeps = {
  groupCtx: null,
  attach: null,
  queueInfo: null,
  loopText: '',
  waitMinutes: 0,
};

/** 正文覆盖（模板预览 / 测试）：id → 模板正文；不给就用类里的内置模板。 */
export type TemplateOverrides = Record<string, string | undefined>;

/** 按时机链构造插件（链内已按 order 升序）。 */
export function buildPlugins(
  group: PluginGroup,
  deps: Partial<DeliveryPluginDeps> = {},
  overrides: TemplateOverrides = {},
): AnyPromptPlugin[] {
  const d = { ...EMPTY_DEPS, ...deps };
  const text = (id: string): string => String(overrides[id] ?? '');
  switch (group) {
    case 'get':
      return [
        new ContextPlugin(text('context'), { groupCtx: d.groupCtx }),
        new AttachmentPlugin(text('attachment'), { attach: d.attach }),
        new ExtPlugin(text('ext'), { queueInfo: d.queueInfo }),
        new AckPlugin(text('ack')),
        new GetloopPlugin(text('getloop'), { loopText: d.loopText, waitMinutes: d.waitMinutes }),
      ];
    case 'check':
      return [new TimecheckPlugin(text('timecheck')), new GoalhintPlugin(text('goalhint'))];
    case 'done':
      return [new DoneguardPlugin(text('doneguard'))];
    default:
      throw new Error(`未知提示词时机：${String(group)}`);
  }
}

/** 全部时机的插件（注册表 / 设置页用；不取数）。 */
export function buildAllPlugins(overrides: TemplateOverrides = {}): AnyPromptPlugin[] {
  return [
    ...buildPlugins('get', {}, overrides),
    ...buildPlugins('check', {}, overrides),
    ...buildPlugins('done', {}, overrides),
  ];
}

export { deliveryCtxOf } from './plugins/context.js';

// ── 写路径校验的数据源 ─────────────────────────────────────────────────

/** seed 段（compose 的种子数据；无输出段，因此没有 order 位）。 */
export const SEED_SEGMENTS: readonly string[] = ['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params'];

/** 全部交付插件 id（按时机链 + 链内 order 的稳定序）。 */
export const PLUGIN_IDS: readonly string[] = Object.freeze(allPluginIds());

/** 某时机的链 id（按 order）。 */
export { groupPluginIds };

const fieldCache = new Map<string, { fields: string[]; top: string[] }>();

/** 某插件的字段目录：fields 全键 + 顶层段（从 dataSchema 派生，缓存）。 */
export function fieldCatalogOf(id: string): { fields: string[]; top: string[] } {
  const hit = fieldCache.get(id);
  if (hit) return hit;
  const p = pluginMeta(id);
  if (!p) throw new Error(`未知提示词插件：${id}`);
  const fields = p.schema.fields.map((f) => f.key);
  const top = [...new Set(fields.map((k) => k.split('.')[0]!))];
  const out = { fields, top };
  fieldCache.set(id, out);
  return out;
}

/**
 * 白名单校验入参（**全局段集**）：ctx 全共享是既有语义，per-block 硬隔离会误伤
 * 旧 CLI 入口与跨段引用；白名单的目标收敛为「拦拼错的段名 / 变量名」——
 * 段集合 = 全部插件 writes ∪ seed ∪ 全部 fields 顶层；字段键 = 全部 fields 并集。
 */
export function globalTemplateVarScope(): { allowedSegments: string[]; fieldKeys: string[] } {
  const segments = new Set<string>(SEED_SEGMENTS);
  const keys = new Set<string>();
  for (const id of PLUGIN_IDS) {
    const p = pluginMeta(id)!;
    for (const w of p.writes) segments.add(w);
    const { fields, top } = fieldCatalogOf(id);
    for (const t of top) segments.add(t);
    for (const f of fields) keys.add(f);
  }
  return { allowedSegments: [...segments], fieldKeys: [...keys] };
}

/** 某插件当前生效的模板正文（#152：就是类里 templates[0]）。 */
export function activeTemplateOf(id: string): string {
  const p = pluginMeta(id);
  if (!p) throw new Error(`未知提示词插件：${id}`);
  return p.get();
}

/** 区块显示名（错误消息 / 设置页 tab 用）——从插件 label 派生，不写第二份。 */
export function blockLabelOf(id: string): string {
  const p = pluginMeta(id);
  if (!p) throw new Error(`未知提示词插件：${id}`);
  return p.label;
}
