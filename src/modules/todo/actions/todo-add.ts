// todo.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** todo.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  text: z.string(),
  topic: z.string().describe("主题，路由维度"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoAddAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.add',
    cli: ['todo', 'add'],
    http: ['POST', '/api/todo'],
    summary: '新增任务到待办（topic 不在快捷列表时自动补上）',
    args: ['text'],
    input,
    render: (d: any) =>
        `已加入待办: [${d.task.topic}] ${d.task.text}` +
        (d.topicAdded ? `\n（已把 ${d.task.topic} 加入快捷 topic）` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addTodo({ topic: ctx.topic, text: ctx.text, groupId: ctx.group });
  
  }
}
