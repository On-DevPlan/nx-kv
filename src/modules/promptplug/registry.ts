// promptplug 注册表（#152）：插件类的**唯一装配点**，也是 id / group / 顺序的派生源。
//
// 为什么是「一个数组 + 派生」而不是运行时扫描目录：本仓 node 侧是 tsc 打包产物，
// 没有运行时模块发现；再加一份 JSON 注册表就退回了 #152 要干掉的东西。
// 所以真相是这一个 `PLUGIN_CLASSES` 数组：加一个插件 = 写一个类 + 往这里加一行，
// 其余（id 清单 / 每个时机的链 / 字段目录 / 顺序位）全部由类声明派生。
//
// group 语义（用户口径「时机即 group」）：
//   get   —— 领取交付时拼的那段（上下文 / 附件 / 队列 / ack / 持续 get）
//   check —— 每轮检查时拼的那段（时间目标）
//   done  —— 尝试完成时拼的那段（完成门禁）
import type { AnyPromptPlugin } from '../../shared/prompt-plugin.js';
import { assertPluginList } from '../../shared/prompt-plugin.js';
import type { PluginGroup, TemplateText } from './base.js';
import { PLUGIN_GROUPS } from './base.js';
import { AttachmentPlugin } from './plugins/attachment.js';
import { ContextPlugin } from './plugins/context.js';
import { ExtPlugin } from './plugins/ext.js';
import { GetloopPlugin } from './plugins/getloop.js';
import { AckPlugin } from './plugins/ack.js';
import { DoneguardPlugin } from './plugins/doneguard.js';
import { GoalhintPlugin } from './plugins/goalhint.js';
import { TimecheckPlugin } from './plugins/timecheck.js';

/** 插件类（构造签名不统一：有的只吃模板，有的还要宿主 deps）。 */
type PluginCtor = new (template: string, deps?: any) => AnyPromptPlugin;

/**
 * 全部插件类（**注册的唯一真相**）。
 * 数组顺序无关——链内顺序由各类的 `order` 决定；这里只是人工阅读的排列。
 */
export const PLUGIN_CLASSES: readonly PluginCtor[] = [
  ContextPlugin,
  AttachmentPlugin,
  TimecheckPlugin,
  GoalhintPlugin,
  DoneguardPlugin,
  ExtPlugin,
  AckPlugin,
  GetloopPlugin,
] as unknown as readonly PluginCtor[];

let metas: AnyPromptPlugin[] | null = null;

/** 用空 deps 造元信息实例（只读声明面：id/order/group/tag/label/templates/schema）。 */
function allMetas(): AnyPromptPlugin[] {
  if (!metas) metas = PLUGIN_CLASSES.map((Ctor) => new Ctor('', {}));
  return metas;
}

/** 按 id 取元信息实例（不取数：buildData 永远不调）。 */
export function pluginMeta(id: string): AnyPromptPlugin | undefined {
  const want = String(id || '');
  return allMetas().find((p) => p.id === want);
}

let checked = false;

/**
 * 全量不变量校验（id 唯一 / 链内 order 唯一 / 模板非空 / tag 合法 / 写回段不撞车）。
 * 只跑一次：注册表是编译期常量，启动后不会变。
 */
export function assertRegistry(): void {
  if (checked) return;
  assertPluginList(allMetas());
  checked = true;
}

/** 某个时机的链（按 order 升序）。 */
export function groupPluginIds(group: PluginGroup): string[] {
  return allMetas()
    .filter((p) => p.group === group)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id);
}

/** 全部插件 id（按 group 再按 order 的稳定序）——uiDescriptor / 白名单共用。 */
export function allPluginIds(): string[] {
  return PLUGIN_GROUPS.flatMap((g) => groupPluginIds(g));
}

/** 时机链索引：{ get: [...], check: [...], done: [...] }（注册表 / 设置页 / 预览共用）。 */
export function groupIndex(): Record<PluginGroup, string[]> {
  const out = {} as Record<PluginGroup, string[]>;
  for (const g of PLUGIN_GROUPS) out[g] = groupPluginIds(g);
  return out;
}

/** 某插件的内置模板列表（至少一条；第一条 = 出厂默认）。 */
export function templatesOf(id: string): readonly TemplateText[] {
  const p = pluginMeta(id);
  return p ? p.templates : [];
}

/** 某插件所在的时机链。 */
export function groupOf(id: string): PluginGroup | '' {
  const p = pluginMeta(id);
  return p ? (p.group as PluginGroup) : '';
}
