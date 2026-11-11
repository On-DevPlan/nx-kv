// doc.attachments —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docAttachmentsInput } from '../schemas.js';
import { listDocAttachments as _listDocAttachments } from '../attach.js';
import { renderAttachments as _renderAttachments } from '../render.js';
const listDocAttachments: any = _listDocAttachments;
const renderAttachments: any = _renderAttachments;

export class DocAttachmentsAction extends ActionBase<typeof docAttachmentsInput> {
  @action({
    id: 'doc.attachments',
    cli: ['docs', 'attachments'],
    http: ['GET', '/api/docs/attachments'],
    summary: '这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用）',
    args: ['ref'],
    input: docAttachmentsInput,
    render: renderAttachments,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return listDocAttachments(ctx);
  
  }
}
