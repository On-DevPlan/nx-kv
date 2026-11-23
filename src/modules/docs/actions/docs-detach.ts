// docs.detach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { detachFromDoc as _detachFromDoc } from '../attach.js';
import { renderDetach as _renderDetach } from '../render.js';
const detachFromDoc: any = _detachFromDoc;
const renderDetach: any = _renderDetach;

/** docs.detach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
  attachment: z.string().describe("资源 id（见 docs attachments）"),
});

export class DocsDetachAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.detach',
    cli: ['docs', 'detach'],
    http: ['DELETE', '/api/docs/attach'],
    summary: '解除文档与附件的关系（#189：只解除关联；清理走库级 GC，不在这里删资源）',
    args: ['ref'],
    input,
    render: renderDetach,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return (detachFromDoc as any)(ctx);
  }
}
