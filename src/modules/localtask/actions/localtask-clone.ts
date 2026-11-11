// localtask.clone —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskCloneInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskCloneAction extends ActionBase<typeof localtaskCloneInput> {
  @action({
    id: 'localtask.clone',
    cli: ['localtask', 'clone'],
    http: ['POST', '/api/localtasks/clone'],
    summary: '克隆任务：复制正文内容为一条新任务（同主题；全局任务仍进全局池）。不带派生链、不继承时间目标与依赖——开新活用',
    input: localtaskCloneInput,
    render: (d: any) =>
      `已克隆 #${d.from.id} → #${d.task.id} @ ${d.name}（内容复制，无派生链；${d.delivered ? '已实时投递' : '待领取'}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.cloneTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
