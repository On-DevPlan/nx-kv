// localtask.attach-note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';

/** localtask.attach-note 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  attachment: z.string().describe("资源 id（见 localtask attachments）"),
  note: z.string().optional().describe("说明文字（留空 = 清掉）"),
});

export class LocaltaskAttachNoteAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.attach-note',
    cli: ['localtask', 'attach-note'],
    http: ['PATCH', '/api/localtasks/attach-note'],
    summary: '改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变）',
    input,
    render: (d: any) => `已更新 ${d.attachment} 的说明：${d.note || '（清空）'}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { noteTaskAttachment } = await (import('../../tasktool/attach.js') as any);
        return noteTaskAttachment({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          attachment: ctx.attachment,
          note: ctx.note,
        });
    
  }
}
