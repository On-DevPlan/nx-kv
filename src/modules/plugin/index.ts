// plugin 模块：内部插件宿主（插件包发现 / 全局开关 / 入口可见性 / pretask 草稿 / RPC）。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class PluginModule extends ModuleBase {
  override readonly id = 'plugin';
  override readonly title = '插件（内部插件宿主 / pretask 入口）';
  override readonly order = 22;

  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const pluginModule = new PluginModule();
export default pluginModule;
