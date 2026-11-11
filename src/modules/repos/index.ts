// repos 模块（模板形态）：只做装配——模块元信息 + 从 action 清单建实例。
//
// action 清单由 `pnpm gen:actions` 扫 actions/ 目录生成（actions/_manifest.generated.ts），
// 本文件**不手工列举** action 类——加一条 action = 新建一个文件 + 跑一次生成。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class ReposModule extends ModuleBase {
  override readonly id = 'repos';
  override readonly title = "仓库上下文（= Web「仓库」页；本地任务的主题会带上这里的上下文）";
  override readonly order = 10;
  override readonly resource = 'repo';

  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const reposModule = new ReposModule();
export default reposModule;
