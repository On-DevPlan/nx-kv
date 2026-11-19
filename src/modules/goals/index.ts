// goals 模块（模板形态）：目标域——时间目标与调度目标。
//
// 三族目标插件（BasePlugin 家族，IoC 自注册）+ timegoal CLI 命令族：
//   timegoal（目录级预算）/ taskgoal（任务级时长门）/ blockgoal（屏障闸门）。
// 存储与运行时在 plugins/；调度器与快照同步在 localtask 域（那是写路径的底座）。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class GoalsModule extends ModuleBase {
  override readonly id = 'goals';
  override readonly title = "目标（timegoal 目录级预算 / taskgoal 任务级时长门 / blockgoal 屏障）";
  override readonly order = 23;

  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const goalsModule = new GoalsModule();
export default goalsModule;
