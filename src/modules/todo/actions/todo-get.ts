// todo.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderTask } from '../support.js';
const service: any = serviceNs;

export class TodoGetAction extends ActionBase<typeof todoGetInput> {
  @action({
    id: 'todo.get',
    cli: ['todo', 'get'],
    http: ['GET', '/api/todo/item'],
    summary: '查看单个任务（按内容定位；自动在待办/已完成/冻结里找）',
    input: todoGetInput,
    render: renderTask,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getTodo(ctx.ref, { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
