// claim 模块（模板形态）：任务系统的核心动词——领取。
//
// 领取链在这里闭环：claim action（CLI `localtask get` / HTTP `/api/localtasks/claim`）
// → getTask → waitForTask（阻塞窗口）→ 交付组装（delivery 域的 host + promptplug 的 assemble）。
// 持续 get（waitgoal）配置也在本域：项目级开关 + 阻塞分钟数。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class ClaimModule extends ModuleBase {
  override readonly id = 'claim';
  override readonly title = "任务领取（= CLI `localtask get` / HTTP claim；等待与持续 get 在此闭环）";
  override readonly order = 21;

  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const claimModule = new ClaimModule();
export default claimModule;
