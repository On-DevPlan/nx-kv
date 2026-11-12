// doc.link-file —— 登记一个本地 md 文件并挂到文档附件区（不复制正文）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { attachToDoc } from '../attach.js';

const input = z.object({
  ref: z.string(),
  path: z.string().describe('本地 .md 文件的绝对路径（相对路径按当前目录解析）'),
  name: z.string().optional().describe('显示名（默认取文件名）'),
  note: z.string().optional().describe('附件区备注'),
});

export class DocLinkFileAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.link-file',
    cli: ['docs', 'link-file'],
    http: ['POST', '/api/docs/link-file'],
    summary: '把本地 md 文件登记为 mdfile 附件并挂到文档附件区：只存路径指针，不复制正文，不改文档正文',
    args: ['ref'],
    input,
    render: (d: { ref: string; attachmentId: string; name?: string }) =>
      `已登记 mdfile ${d.attachmentId}（${d.name || d.ref}）→ 文档 ${d.ref} 的附件区`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return attachToDoc({ ref: ctx.ref, mdfile: ctx.path, name: ctx.name, note: ctx.note, noEmbed: true });
  }
}
