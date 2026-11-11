// todo.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderTask } from '../support.js';
const service: any = serviceNs;

/** todo.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string().describe("任务内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoGetAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.get',
    cli: ['todo', 'get'],
    http: ['GET', '/api/todo/item'],
    summary: '查看单个任务（按内容定位；自动在待办/已完成/冻结里找）',
    input,
    render: renderTask,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
