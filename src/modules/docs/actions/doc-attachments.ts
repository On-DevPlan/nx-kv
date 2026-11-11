// doc.attachments —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listDocAttachments as _listDocAttachments } from '../attach.js';
import { renderAttachments as _renderAttachments } from '../render.js';
const listDocAttachments: any = _listDocAttachments;
const renderAttachments: any = _renderAttachments;

/** doc.attachments 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
});

export class DocAttachmentsAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.attachments',
    cli: ['docs', 'attachments'],
    http: ['GET', '/api/docs/attachments'],
    summary: '这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用）',
    args: ['ref'],
    input,
    render: renderAttachments,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return listDocAttachments(ctx);
  
  }
}
