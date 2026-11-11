// todo.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoUpdateInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoUpdateAction extends ActionBase<typeof todoUpdateInput> {
  @action({
    id: 'todo.update',
    cli: ['todo', 'update'],
    http: ['PATCH', '/api/todo/item'],
    summary: '编辑任务（按内容定位，只改传入的字段）',
    input: todoUpdateInput,
    render: (d: any) => `已更新（在 ${d.bucket}）: [${d.task.topic}] ${d.task.text}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.updateTodo(ctx.ref, {
            topic: ctx.topic,
            text: ctx.text,
            note: ctx.note,
            matchTopic: ctx.matchTopic,
            pick: ctx.pick,
            groupId: ctx.group,
          });
  
  }
}
