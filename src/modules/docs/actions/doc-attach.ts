// doc.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docAttachInput } from '../schemas.js';
import { attachToDoc as _attachToDoc } from '../attach.js';
import { renderAttach as _renderAttach } from '../render.js';
const attachToDoc: any = _attachToDoc;
const renderAttach: any = _renderAttach;

export class DocAttachAction extends ActionBase<typeof docAttachInput> {
  @action({
    id: 'doc.attach',
    cli: ['docs', 'attach'],
    http: ['POST', '/api/docs/attach'],
    summary: '给文档挂资源：--path / --fileId / --url / --task / --doc 之一；默认追加进正文，--no-embed 只挂附件区（不写正文）',
    args: ['ref'],
    input: docAttachInput,
    render: renderAttach,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return (attachToDoc as any)(ctx);
  }
}
