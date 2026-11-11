// doc.attach-note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { noteOnDoc as _noteOnDoc } from '../attach.js';
const noteOnDoc: any = _noteOnDoc;

/** doc.attach-note 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
  attachment: z.string().describe("资源 id（见 docs attachments）"),
  note: z.string().optional().describe("说明文字（留空 = 清掉）"),
});

export class DocAttachNoteAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.attach-note',
    cli: ['docs', 'attach-note'],
    http: ['PATCH', '/api/docs/attach-note'],
    summary: '改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变）',
    args: ['ref'],
    input,
    render: (d: any) => `已更新 ${d.attachment} 的说明：${d.note || '（清空）'}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return noteOnDoc({ ref: ctx.ref, attachment: ctx.attachment, note: ctx.note });
  
  }
}
