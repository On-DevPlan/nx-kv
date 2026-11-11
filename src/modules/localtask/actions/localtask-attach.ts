// localtask.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';

/** localtask.attach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  path: z.string().optional().describe("本机文件路径（落 ~/.nx-kv/attachments/local/ 再登记）"),
  fileId: z.string().optional().describe("已有附件的 id（32 位 hex，可带扩展名；本机仓或云端）"),
  url: z.string().optional().describe("外部链接（http/https；kind=url）"),
  task: z.string().optional().describe("同主题下的任务编号（kind=task，落 nxkv://task/<id>）"),
  ref: z.string().optional().describe("文档路径或 ref id（kind=ref，落 nxkv://ref/<refId>）"),
  inline: z.boolean().optional().describe("文档进原文：交付时附全文（截断 2 万字）而不是只给路径；仅 --ref 有效"),
  name: z.string().optional().describe("显示名 / 本地文件名（默认取原名）"),
  kind: z.string().optional().describe("image | file（仅 --path/--fileId 用；不给按扩展名判）"),
  note: z.string().optional().describe("绑定说明（desc）：附件区条目备注 / 文档绑定的一行简介，交付清单透出"),
  noEmbed: z.boolean().optional().describe("只写 attachments + task_attach（role=attach），不改正文"),
  'no-embed': z.boolean().optional().describe("同 --noEmbed（连字符写法）"),
});

export class LocaltaskAttachAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.attach',
    cli: ['localtask', 'attach'],
    http: ['POST', '/api/localtasks/attach'],
    summary: '给任务挂附件：--path 存本机附件仓 / --fileId 引用已有附件 / --url / --task（同主题任务）/ --ref（文档）；默认嵌进正文，--no-embed 只挂到附件区（不写正文），--ref 加 --inline 文档进原文（交付带全文）',
    input,
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
