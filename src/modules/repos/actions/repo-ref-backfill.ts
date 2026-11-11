// repo.ref.backfill —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refBackfillNs from '../ref-backfill.js';
import { renderBackfill as _renderBackfill } from '../cli/render.js';
const refBackfill: any = refBackfillNs;
const renderBackfill: any = _renderBackfill;

/** repo.ref.backfill 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  from: z.string(),
  'dry-run': z.boolean().optional().describe("只算差异，不落盘"),
});

export class RepoRefBackfillAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.backfill',
    cli: ['repo', 'ref', 'backfill'],
    http: null,
    summary: '从 v3 快照补录仓库级参考绑定（幂等、可重复；与组级绑定并存；--dry-run 只预览）',
    args: ['from'],
    input,
    render: renderBackfill,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refBackfill.backfillRepoLinks({ from: ctx.from, dryRun: ctx['dry-run'] === true });
  
  }
}
