// todo.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderTaskList } from '../support.js';
const service: any = serviceNs;

export class TodoListAction extends ActionBase<typeof todoListInput> {
  @action({
    id: 'todo.list',
    cli: ['todo', 'list'],
    http: ['GET', '/api/todo'],
    summary: '列出任务（--topic / --status 过滤；默认三个桶全列）',
    input: todoListInput,
    render: renderTaskList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listTodos({ topic: ctx.topic, status: ctx.status, groupId: ctx.group });
  
  }
}
