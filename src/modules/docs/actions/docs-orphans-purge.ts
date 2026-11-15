// docs.orphans.purge —— 到期孤儿的预演 / 软删。
//
// 默认 dry-run：只列「会被删的篇目」。`--apply` 才软删空正文且到期的孤儿；
// 有正文的到期孤儿永远只进清单（skippedWithBody），不自动删。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { sweepOrphans, renderOrphans } from '../orphan.js';

/** docs.orphans.purge 的入参契约（CLI 与 HTTP 共用）。 */
const input = z.object({
  apply: z.boolean().optional().describe('真的软删（缺省 = 只预演，不动数据）'),
  ttlDays: z.number().int().min(1).max(3650).optional().describe('按指定保留天数额外算一遍（不落库；缺省读设置）'),
});

export class DocsOrphansPurgeAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.orphans.purge',
    cli: ['docs', 'orphans', 'purge'],
    http: ['POST', '/api/docs/orphans/purge'],
    summary: '孤儿到期清理（默认只预演；--apply 软删空正文到期孤儿，有正文的只列清单）',
    input,
    render: renderOrphans,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return sweepOrphans({ apply: ctx.apply === true, ttlDays: ctx.ttlDays, source: 'cli' });
  }
}
