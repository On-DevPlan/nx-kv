// doc.attach-note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { docAttachNoteInput } from '../schemas.js';
import { noteOnDoc as _noteOnDoc } from '../attach.js';
const noteOnDoc: any = _noteOnDoc;

export class DocAttachNoteAction extends ActionBase {
  @action({
    id: 'doc.attach-note',
    cli: ['docs', 'attach-note'],
    http: ['PATCH', '/api/docs/attach-note'],
    summary: '改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变）',
    args: ['ref'],
    input: docAttachNoteInput,
    render: (d: any) => `已更新 ${d.attachment} 的说明：${d.note || '（清空）'}`,
  })
  async attachNote(ctx: any) {

      return noteOnDoc({ ref: ctx.ref, attachment: ctx.attachment, note: ctx.note });
  
  }
}
