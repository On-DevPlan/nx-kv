// localtask.attachments —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskAttachmentsInput } from '../schemas.js';
import { renderTaskAttachments as _renderTaskAttachments } from '../action-render.js';
const renderTaskAttachments: any = _renderTaskAttachments;

export class LocaltaskAttachmentsAction extends ActionBase<typeof localtaskAttachmentsInput> {
  @action({
    id: 'localtask.attachments',
    cli: ['localtask', 'attachments'],
    http: ['GET', '/api/localtasks/attachments'],
    summary: '列出某条任务引用的附件（正文里的 ![名](fileId) 嵌入），以及本地是否已有（给 agent 直接读本地文件）',
    input: localtaskAttachmentsInput,
    render: renderTaskAttachments,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { listTaskAttachments } = await (import('../../tasktool/attach.js') as any);
        return listTaskAttachments({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
    
  }
}
