// todo.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderTaskList } from '../support.js';
const service: any = serviceNs;

/** todo.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  topic: z.string().optional().describe("只看某个主题"),
  status: z.enum(["open", "done", "freeze", "all"]).default('all'),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoListAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.list',
    cli: ['todo', 'list'],
    http: ['GET', '/api/todo'],
    summary: '列出任务（--topic / --status 过滤；默认三个桶全列）',
    input,
    render: renderTaskList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listTodos({ topic: ctx.topic, status: ctx.status, groupId: ctx.group });
  
  }
}
