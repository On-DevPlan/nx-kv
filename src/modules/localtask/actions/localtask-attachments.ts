// localtask.attachments —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { renderTaskAttachments as _renderTaskAttachments } from '../action-render.js';
const renderTaskAttachments: any = _renderTaskAttachments;

/** localtask.attachments 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskAttachmentsAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.attachments',
    cli: ['localtask', 'attachments'],
    http: ['GET', '/api/localtasks/attachments'],
    summary: '列出某条任务引用的附件（正文里的 ![名](fileId) 嵌入），以及本地是否已有（给 agent 直接读本地文件）',
    input,
    render: renderTaskAttachments,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { listTaskAttachments } = await (import('../../tasktool/attach.js') as any);
        return listTaskAttachments({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
    
  }
}
