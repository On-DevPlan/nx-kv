// todo.done —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { todoDoneInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoDoneAction extends ActionBase {
  @action({
    id: 'todo.done',
    cli: ['todo', 'done'],
    http: ['POST', '/api/todo/done'],
    summary: '标记完成（--ref 定位；--result 写进 note 作为完成结果）',
    input: todoDoneInput,
    render: (d: any) => `已完成 [${d.task.topic}] ${d.task.text}\n  ${d.task.doneAt}`,
  })
  async done(ctx: any) {

      return service.doneTodo(ctx.ref, { result: ctx.result, topic: ctx.topic, pick: ctx.pick, groupId: ctx.group });
  
  }
}
