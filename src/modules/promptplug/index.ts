// promptplug 装配：模块元信息 + action 清单装配（方案 §8 index.ts）。
//
// 插件工厂 / 字段目录 / 白名单数据源在 factory.ts（actions 经 manifest 引工厂，
// 不能回环引本文件）。依赖方向（设计内，见方案 §8 说明）：tasktool 是唯一消费方
// ——宿主完成领域取数，把结果注入插件构造；插件 data() 只做同步变换。
// promptplug 不 import 其他模块。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

// 装配无关的公开面（历史 import 路径保持不变：tasktool / settings.ts 从这里拿）
export {
  blockLabelOf,
  buildDeliveryPlugins,
  deliveryCtxOf,
  fieldCatalogOf,
  globalTemplateVarScope,
  PLUGIN_IDS,
  SEED_SEGMENTS,
} from './factory.js';
export type { DeliveryPluginDeps, ResolvedTemplates } from './factory.js';

/**
 * 提示词插件模块：注册表外露（prompt.registry / prompt.order，方案 §5.3）。
 * 业务面（compose / buildDeliveryPlugins）由 tasktool 直接消费——这是设计内依赖
 * （tasktool → promptplug，见 docs/research/prompt-plugin-single-route.md §8）。
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
