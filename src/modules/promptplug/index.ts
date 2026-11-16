// promptplug 装配：插件清单 + 交付插件工厂（方案 §8 index.ts）。
//
// 依赖方向（设计内，见方案 §8 说明）：tasktool 是唯一消费方——宿主完成领域取数
// （readGroupContext / annotateTaskDelivery / pendingQueueInfo / getloop 指令渲染），
// 把结果注入插件构造；插件 data() 只做同步变换。promptplug 不 import 其他模块。
import type { AnyPromptPlugin } from '../../shared/prompt-plugin.js';
import { ModuleBase } from '../../runtime/types/module.js';
import { ContextPlugin } from './plugins/context.js';
import { AttachmentPlugin } from './plugins/attachment.js';
import { ExtPlugin } from './plugins/ext.js';
import { GetloopPlugin } from './plugins/getloop.js';
import { AckPlugin, DoneguardPlugin, GoalhintPlugin, TimecheckPlugin } from './plugins/readonly-blocks.js';

/** 每段生效模板（lt.blockTemplates 归一化后的 resolved 项，id → template）。 */
export type ResolvedTemplates = Record<string, { template: string } | undefined>;

/** 交付插件构造所需的宿主取数结果（全部可同步拿到）。 */
export interface DeliveryPluginDeps {
  groupCtx: unknown;
  attach: unknown;
  queueInfo: { topic: string; count: number; list: { id: number; title: string }[] } | null;
  loopText: string;
  waitMinutes: number;
}

/** 按默认 order 位构造 8 个交付插件（模板注入：DB 归一化后的生效项）。 */
export function buildDeliveryPlugins(
  tpl: ResolvedTemplates,
  deps: DeliveryPluginDeps,
): AnyPromptPlugin[] {
  const t = (id: string): string => String(tpl[id]?.template ?? '');
  return [
    new ContextPlugin(t('context'), { groupCtx: deps.groupCtx }),
    new AttachmentPlugin(t('attachment'), { attach: deps.attach }),
    new TimecheckPlugin(t('timecheck')),
    new GoalhintPlugin(t('goalhint')),
    new DoneguardPlugin(t('doneguard')),
    new ExtPlugin(t('ext'), { queueInfo: deps.queueInfo }),
    new AckPlugin(t('ack')),
    new GetloopPlugin(t('getloop'), { loopText: deps.loopText, waitMinutes: deps.waitMinutes }),
  ];
}

export { deliveryCtxOf } from './plugins/context.js';

// ── 写路径校验的数据源（方案 §4.2）───────────────────────────────────────

/** seed 段（compose 的种子数据；无输出段，因此没有 order 位）。 */
export const SEED_SEGMENTS: readonly string[] = ['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params'];

const fieldCache = new Map<string, { fields: string[]; top: string[] }>();

/** 某插件的字段目录：fields 全键 + 顶层段（从 dataSchema 派生，缓存）。 */
export function fieldCatalogOf(id: string): { fields: string[]; top: string[] } {
  const hit = fieldCache.get(id);
  if (hit) return hit;
  const p = pluginById(id);
  if (!p) throw new Error(`未知提示词插件：${id}`);
  const fields = p.schema.fields.map((f) => f.key);
  const top = [...new Set(fields.map((f) => f.split('.')[0]!))];
  const out = { fields, top };
  fieldCache.set(id, out);
  return out;
}

/** 按模板注入构造单个插件（fields / writes 与模板正文无关，空串即可）。 */
function pluginById(id: string): AnyPromptPlugin | undefined {
  const t = '';
  const deps = { groupCtx: null, attach: null, queueInfo: null, loopText: '', waitMinutes: 0 };
  return buildDeliveryPlugins({ [id]: { template: t } }, deps).find((x) => x.id === id);
}

/**
 * 白名单校验入参（**全局段集**，落地裁决——见方案 §4.2 补记）：
 * ctx 全共享是既有语义（「不存在某模块自带一套变量域」），per-block 硬隔离会误伤
 * 旧 CLI 入口与跨段引用；白名单的目标收敛为「拦拼错的段名 / 变量名」——
 * 段集合 = 全部插件 writes ∪ seed ∪ 全部 fields 顶层；字段键 = 全部 fields 并集。
 */
export function globalTemplateVarScope(): { allowedSegments: string[]; fieldKeys: string[] } {
  const segments = new Set<string>(SEED_SEGMENTS);
  const keys = new Set<string>();
  for (const id of PLUGIN_IDS) {
    const p = pluginById(id)!;
    for (const w of p.writes) segments.add(w);
    const { fields, top } = fieldCatalogOf(id);
    for (const t of top) segments.add(t);
    for (const f of fields) keys.add(f);
  }
  return { allowedSegments: [...segments], fieldKeys: [...keys] };
}

/** 全部交付插件 id（8 段）。 */
export const PLUGIN_IDS: readonly string[] = [
  'context', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext', 'ack', 'getloop',
];

/**
 * 提示词插件模块（S1：机制库，无 action；S3 起挂 prompt registry/order 三个 action）。
 * 业务面（compose / buildDeliveryPlugins）由 tasktool 直接消费——这是设计内依赖
 * （tasktool → promptplug，见 docs/research/prompt-plugin-single-route.md §8）。
 */
export class PromptplugModule extends ModuleBase {
  override readonly id = 'promptplug';
  override readonly title = '提示词插件';
  override readonly order = 85;
  override readonly actions: readonly unknown[] = [];
}
