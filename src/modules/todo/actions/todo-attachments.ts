// todo.attachments —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { todoAttachmentsInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderTaskAttachments } from '../support.js';
const service: any = serviceNs;

export class TodoAttachmentsAction extends ActionBase<typeof todoAttachmentsInput> {
  @action({
    id: 'todo.attachments',
    cli: ['todo', 'attachments'],
    http: ['GET', '/api/todo/attachments'],
    summary: '列出某条任务引用的附件，以及本地是否已有（给 agent 直接读本地文件）',
    input: todoAttachmentsInput,
    render: renderTaskAttachments,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listTaskAttachments(ctx.ref, ctx);
  
  }
}
