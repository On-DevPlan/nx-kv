// todo.unfreeze —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoUnfreezeInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoUnfreezeAction extends ActionBase<typeof todoUnfreezeInput> {
  @action({
    id: 'todo.unfreeze',
    cli: ['todo', 'unfreeze'],
    http: ['POST', '/api/todo/unfreeze'],
    summary: '解冻回待办（按内容定位；id 撞车时自动换新 id）',
    input: todoUnfreezeInput,
    render: (d: any) =>
        `已解冻 [${d.task.topic}] ${d.task.text}` +
        (d.reIded ? '\n（原 id 与现有待办冲突，已分配新 id）' : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.unfreezeTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
