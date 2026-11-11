// todo.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { todoAttachInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoAttachAction extends ActionBase {
  @action({
    id: 'todo.attach',
    cli: ['todo', 'attach'],
    http: ['POST', '/api/todo/attach'],
    summary: '给任务追加附件：--path 上传本机文件，或 --fileId 追加已上传附件，以 markdown 嵌入正文末尾',
    input: todoAttachInput,
    render: (d: any) => `已给 [${d.task.topic}] 追加附件（${d.kind === 'image' ? '图片' : '附件'}）\n  ${d.markdown}\n  正文: ${d.task.text}`,
  })
  async attach(ctx: any) {

      return service.attachToTask(ctx.ref, ctx);
  
  }
}
