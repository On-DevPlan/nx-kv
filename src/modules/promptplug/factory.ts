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
import { AckPlugin } from './plugins/ack.js';
import { DoneguardPlugin } from './plugins/doneguard.js';
import { GoalhintPlugin } from './plugins/goalhint.js';
import { TimecheckPlugin } from './plugins/timecheck.js';
import { varScopeOf as varScopeOfFields } from '../../shared/prompt-plugin.js';
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

// ── 校验用的数据源 ─────────────────────────────────────────────────────

/** seed 段（宿主在 run 时传入的那份数据；每段都有一份，只读）。唯一真相在 shared。 */
export { SEED_SEGMENTS } from '../../shared/prompt-plugin.js';

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
  const top = [...new Set(fields.map((k) => k.split('.')[0]!.replace(/\[\]$/, '')))];
  const out = { fields, top };
  fieldCache.set(id, out);
  return out;
}

/**
 * 某一段可见的变量域（**不再有全局段集**）：seed ∪ 本段 dataSchema 顶层。
 *
 * 旧实现是「全局段集 + 全部字段并集」——那等于允许 a 段引用 b 段的变量，
 * 跨段耦合被白名单亲手放行。#153 起每段只看自己的数据，白名单与运行期同域。
 */
export function varScopeOf(id: string): { allowedSegments: string[]; fieldKeys: string[] } {
  const p = pluginMeta(id);
  if (!p) throw new Error(`未知提示词插件：${id}`);
  return varScopeOfFields(id, p.schema.fields);
}

/** shared 的实现（assertPluginList 直接吃 fields，省一次查表）。 */
export { varScopeOf as varScopeOfFields };

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
