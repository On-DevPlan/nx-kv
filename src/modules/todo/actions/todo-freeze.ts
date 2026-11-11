// todo.freeze —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoFreezeInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoFreezeAction extends ActionBase<typeof todoFreezeInput> {
  @action({
    id: 'todo.freeze',
    cli: ['todo', 'freeze'],
    http: ['POST', '/api/todo/freeze'],
    summary: '冻结任务（按内容定位；id 保留，解冻时校验冲突）',
    input: todoFreezeInput,
    render: (d: any) => `已冻结 [${d.task.topic}] ${d.task.text}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.freezeTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
