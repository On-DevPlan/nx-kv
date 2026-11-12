// doc.ref.unbind —— 解绑一条直接 ref 的归属（不删 ref、不删正文）。
//
// 派生绑定（既有文档由 ext 推导）不在这里处理：摘除仍走宿主的文档集接口。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { unbindRef as _unbindRef } from '../service.js';

const unbindRef: any = _unbindRef;

/** doc.ref.unbind 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string().describe('refId（ref_…）'),
  type: z.enum(['repo', 'group', 'group_repo']).describe('归属类型'),
  repo: z.string().describe('归属宿主的 repo_key（type=group 时给组 key）'),
  group: z.string().optional().describe('组 key（type=group_repo 时必填）'),
});

export class DocRefUnbindAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.ref.unbind',
    cli: ['docs', 'ref', 'unbind'],
    http: ['POST', '/api/docs/unbind'],
    summary: '解绑直接 ref 的归属（不删文档；没有归属后回到 orphan）',
    input,
    render: (d: any) =>
      d.removed
        ? `已解绑 ${d.refId}（${d.orphan ? '已无归属' : '仍有其它归属'}）`
        : `没有匹配的归属可解绑: ${d.refId}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return unbindRef({ ref: ctx.ref, type: ctx.type, repo: ctx.repo, group: ctx.group });
  }
}
