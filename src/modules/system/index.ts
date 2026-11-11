// 系统模块：聚合与自检。没有业务状态，也没有面板视图。
//
// 分层例外：本模块是刻意的聚合器，允许 import 其他模块的 service（放开「模块互依」
// 的 eslint 规则——它是唯一豁免）。
//
// 模板形态：模块是 ModuleBase 子类，只做「元信息 + 装配」；业务 action 在
// actions/ 下一条一个文件（@action 装饰器 + zod 契约），清单由 gen:actions 收进
// _manifest.generated.ts——加一条 action = 新建一个文件 + 跑一次生成，本文件零改动。
import { ModuleBase } from '../../runtime/types/module.js';
import { zodActionsOf, type ZodBoundAction } from '../../runtime/action-decorator.js';
import { container, type Container } from '../../runtime/container.js';
import { ACTIONS } from './actions/_manifest.generated.js';

export class SystemModule extends ModuleBase {
  override readonly id = 'system';
  override readonly title = '系统';
  override readonly order = 0;

  // actions 在构造期组装（依赖要先就绪），故用确定赋值断言而非字段初始化器。
  override readonly actions: readonly ZodBoundAction[];

  constructor(c: Container = container) {
    super();
    this.actions = ACTIONS.flatMap((Cls) => zodActionsOf(c.create(Cls)));
  }
}

export const systemModule = new SystemModule();
export default systemModule;
