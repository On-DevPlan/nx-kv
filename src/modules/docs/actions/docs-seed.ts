// docs.seed —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as seedNs from '../seed.js';
import { renderSeed as _renderSeed } from '../render.js';
const seed: any = seedNs;
const renderSeed: any = _renderSeed;

/** docs.seed 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  apply: z.boolean().optional().describe("执行播种（缺省只预览）"),
});

export class DocsSeedAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.seed',
    cli: ['docs', 'seed'],
    http: ['POST', '/api/docs/seed'],
    summary: '把仓库 desc / 看板 desc / 组内 note 字符串播种成约定路径的 md（缺省预览，--apply 执行；幂等）',
    input,
    render: renderSeed,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return (ctx.apply ? seed.seedApply() : seed.seedPlan());
  
  }
}
