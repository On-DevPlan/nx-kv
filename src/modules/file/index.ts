// file 模块（模板形态）：只做装配——模块元信息 + 从 action 清单建实例。
//
// action 清单由 `pnpm gen:actions` 扫 actions/ 目录生成（actions/_manifest.generated.ts），
// 本文件**不手工列举** action 类——加一条 action = 新建一个文件 + 跑一次生成。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class FileModule extends ModuleBase {
  override readonly id = 'file';
  override readonly title = "附件";
  override readonly order = 40;

  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const fileModule = new FileModule();
export default fileModule;
