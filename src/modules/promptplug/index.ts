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
