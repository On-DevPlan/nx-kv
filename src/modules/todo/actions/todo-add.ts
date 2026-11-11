// todo.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoAddInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoAddAction extends ActionBase<typeof todoAddInput> {
  @action({
    id: 'todo.add',
    cli: ['todo', 'add'],
    http: ['POST', '/api/todo'],
    summary: '新增任务到待办（topic 不在快捷列表时自动补上）',
    args: ['text'],
    input: todoAddInput,
    render: (d: any) =>
        `已加入待办: [${d.task.topic}] ${d.task.text}` +
        (d.topicAdded ? `\n（已把 ${d.task.topic} 加入快捷 topic）` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addTodo({ topic: ctx.topic, text: ctx.text, groupId: ctx.group });
  
  }
}
