// todo.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** todo.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string().describe("要改的那条的内容（整串）"),
  topic: z.string().optional().describe("改成这个主题"),
  text: z.string().optional().describe("改成这个内容"),
  note: z.string().optional(),
  matchTopic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.update',
    cli: ['todo', 'update'],
    http: ['PATCH', '/api/todo/item'],
    summary: '编辑任务（按内容定位，只改传入的字段）',
    input,
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
