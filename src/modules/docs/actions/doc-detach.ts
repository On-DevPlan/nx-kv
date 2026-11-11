// doc.detach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docDetachInput } from '../schemas.js';
import { detachFromDoc as _detachFromDoc } from '../attach.js';
import { renderDetach as _renderDetach } from '../render.js';
const detachFromDoc: any = _detachFromDoc;
const renderDetach: any = _renderDetach;

export class DocDetachAction extends ActionBase<typeof docDetachInput> {
  @action({
    id: 'doc.detach',
    cli: ['docs', 'detach'],
    http: ['DELETE', '/api/docs/attach'],
    summary: '解除文档与附件的关系（默认只解除关系）；--purge 无人引用时连资源行与本机字节一起删',
    args: ['ref'],
    input: docDetachInput,
    render: renderDetach,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return (detachFromDoc as any)(ctx);
  }
}
