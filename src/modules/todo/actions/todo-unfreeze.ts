// todo.unfreeze —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** todo.unfreeze 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string().describe("要解冻的那条的内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoUnfreezeAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.unfreeze',
    cli: ['todo', 'unfreeze'],
    http: ['POST', '/api/todo/unfreeze'],
    summary: '解冻回待办（按内容定位；id 撞车时自动换新 id）',
    input,
    render: (d: any) =>
        `已解冻 [${d.task.topic}] ${d.task.text}` +
        (d.reIded ? '\n（原 id 与现有待办冲突，已分配新 id）' : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.unfreezeTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
