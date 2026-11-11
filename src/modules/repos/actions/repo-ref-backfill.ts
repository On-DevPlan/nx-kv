// repo.ref.backfill —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRefBackfillInput } from '../schemas.js';
import * as refBackfillNs from '../ref-backfill.js';
import { renderBackfill as _renderBackfill } from '../cli/render.js';
const refBackfill: any = refBackfillNs;
const renderBackfill: any = _renderBackfill;

export class RepoRefBackfillAction extends ActionBase {
  @action({
    id: 'repo.ref.backfill',
    cli: ['repo', 'ref', 'backfill'],
    http: null,
    summary: '从 v3 快照补录仓库级参考绑定（幂等、可重复；与组级绑定并存；--dry-run 只预览）',
    args: ['from'],
    input: repoRefBackfillInput,
    render: renderBackfill,
  })
  async backfill(ctx: any) {

      return refBackfill.backfillRepoLinks({ from: ctx.from, dryRun: ctx['dry-run'] === true });
  
  }
}
