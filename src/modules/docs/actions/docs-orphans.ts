// docs.orphans —— 只读列出「没有任何归属（ref_bindings）」的孤儿文档。
//
// 给「谁要到期、还差多久」一个可核对的窗口：失绑时间、剩余天数、是否到期、
// 是否有正文（有正文的到期孤儿不会自动清，必须能单独看见）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listOrphans, renderOrphans } from '../orphan.js';

/** docs.orphans 的入参契约（CLI 与 HTTP 共用）。 */
const input = z.object({
  ttlDays: z.number().int().min(1).max(3650).optional().describe('按指定保留天数额外算一遍（不落库；缺省读设置）'),
});

export class DocsOrphansAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.orphans',
    cli: ['docs', 'orphans'],
    http: ['GET', '/api/docs/orphans'],
    summary: '列出无归属的孤儿文档（失绑时间 / 剩余天数 / 是否有正文；只读）',
    input,
    render: renderOrphans,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return listOrphans({ ttlDays: ctx.ttlDays });
  }
}
