// todo.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoRemoveAction extends ActionBase<typeof todoRemoveInput> {
  @action({
    id: 'todo.remove',
    cli: ['todo', 'remove'],
    http: ['DELETE', '/api/todo/item'],
    summary: '删除任务（按内容定位，只删命中的那一条）',
    input: todoRemoveInput,
    render: (d: any) => `已删除 [${d.removed.topic}] ${d.removed.text}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
