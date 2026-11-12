// doc.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { attachToDoc as _attachToDoc } from '../attach.js';
import { renderAttach as _renderAttach } from '../render.js';
const attachToDoc: any = _attachToDoc;
const renderAttach: any = _renderAttach;

/** doc.attach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
  path: z.string().optional().describe("本机文件路径（落本机附件仓）"),
  fileId: z.string().optional().describe("已有附件 id"),
  url: z.string().optional().describe("外部链接（http/https）"),
  task: z.string().optional().describe("任务全局 id（kind=task）"),
  doc: z.string().optional().describe("另一篇文档的 ref/path（kind=ref）"),
  mdfile: z.string().optional().describe("本地 .md 文件路径（kind=mdfile：只登记指针，不复制正文）"),
  name: z.string().optional().describe("显示名（默认取文件名/原名）"),
  note: z.string().optional().describe("附件区备注"),
  noEmbed: z.boolean().optional().describe("只写 ref_attach（role=attach），不改正文"),
  'no-embed': z.boolean().optional().describe("同 --noEmbed"),
});

export class DocAttachAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.attach',
    cli: ['docs', 'attach'],
    http: ['POST', '/api/docs/attach'],
    summary: '给文档挂资源：--path / --fileId / --url / --task / --doc / --mdfile 之一；默认追加进正文，--no-embed 只挂附件区（不写正文）',
    args: ['ref'],
    input,
    render: renderAttach,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return (attachToDoc as any)(ctx);
  }
}
