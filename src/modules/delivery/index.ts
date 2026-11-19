// delivery 模块（模板形态）：交付域——把一条任务变成「任务 + 说明书」。
//
// host.ts（宿主取数：附件标注 / timegoal 起表 / 组上下文 / 队列余量）
// + assemble.ts（组装核：seed 构造 / 三链合并 / 渲染）
// + 附件四件（标注 / ctx 塑形 / 资源视图模型 / 文档全文）与组上下文、人读排版。
// 纯引擎在 promptplug（段落插件 / 注册表 / 模板存储 / 渲染）。
import { ModuleBase } from '../../runtime/types/module.js';

export class DeliveryModule extends ModuleBase {
  override readonly id = 'delivery';
  override readonly title = "交付组装（宿主取数 + 提示词组装核；提示词引擎在 promptplug）";
  override readonly order = 22;

  override readonly actions: readonly [] = [];
}

export const deliveryModule = new DeliveryModule();
export default deliveryModule;
