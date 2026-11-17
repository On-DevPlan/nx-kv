// promptplug 装配：模块元信息 + action 清单装配。
//
// 插件工厂 / 注册表 / 字段目录在 factory.ts + registry.ts（actions 经 manifest 引
// 工厂，不能回环引本文件）。依赖方向（设计内）：tasktool 是唯一消费方——宿主完成
// 领域取数，以 Supply 形式注入插件；插件在自己的 buildData() 里变换。
// promptplug 不 import 其他模块。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

// 装配无关的公开面（tasktool / settings.ts 从这里拿）
export {
  activeTemplateOf,
  blockLabelOf,
  buildAllPlugins,
  buildPlugins,
  deliveryCtxOf,
  fieldCatalogOf,
  globalTemplateVarScope,
  groupPluginIds,
  PLUGIN_IDS,
  SEED_SEGMENTS,
} from './factory.js';
export type { DeliveryPluginDeps, TemplateOverrides } from './factory.js';
export {
  allPluginIds,
  assertRegistry,
  groupIndex,
  groupOf,
  pluginMeta,
  templatesOf,
} from './registry.js';
export { PLUGIN_GROUPS } from './base.js';
export type { PluginGroup, TemplateText } from './base.js';
export { compose } from './compose.js';

/**
 * 提示词插件模块：注册表外露（prompt.registry）。
 * 业务面（compose / buildPlugins）由 tasktool 直接消费——这是设计内依赖
 * （tasktool → promptplug）。
 */
export class PromptplugModule extends ModuleBase {
  override readonly id = 'promptplug';
  override readonly title = '提示词插件';
  override readonly order = 85;
  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}
