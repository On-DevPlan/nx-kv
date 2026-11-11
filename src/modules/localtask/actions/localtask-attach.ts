// localtask.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskAttachInput } from '../schemas.js';

export class LocaltaskAttachAction extends ActionBase<typeof localtaskAttachInput> {
  @action({
    id: 'localtask.attach',
    cli: ['localtask', 'attach'],
    http: ['POST', '/api/localtasks/attach'],
    summary: '给任务挂附件：--path 存本机附件仓 / --fileId 引用已有附件 / --url / --task（同主题任务）/ --ref（文档）；默认嵌进正文，--no-embed 只挂到附件区（不写正文），--ref 加 --inline 文档进原文（交付带全文）',
    input: localtaskAttachInput,
    render: (d: any) =>
      `已附加 ${d.fileId}（${d.kind === 'image' ? '图片' : d.kind === 'url' ? '链接' : d.kind === 'task' ? '任务' : d.kind === 'ref' ? '文档' : '文件'}）到主题「${d.name}」#${d.task.id} · ${d.role === 'doc' ? '文档资料（交付进原文）' : d.area === 'area' ? '附件区（未写正文）' : '正文内嵌'}${d.markdown ? `\n嵌入: ${d.markdown}` : ''}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { attachToTask } = await (import('../../tasktool/attach.js') as any);
        return attachToTask({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          path: ctx.path,
          fileId: ctx.fileId,
          url: ctx.url,
          task: ctx.task,
          ref: ctx.ref,
          inline: ctx.inline,
          name: ctx.name,
          kind: ctx.kind,
          note: ctx.note,
          noEmbed: !!(ctx.noEmbed ?? ctx['no-embed']),
        });
    
  }
}
