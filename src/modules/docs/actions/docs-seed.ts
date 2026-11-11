// docs.seed —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docsSeedInput } from '../schemas.js';
import * as seedNs from '../seed.js';
import { renderSeed as _renderSeed } from '../render.js';
const seed: any = seedNs;
const renderSeed: any = _renderSeed;

export class DocsSeedAction extends ActionBase<typeof docsSeedInput> {
  @action({
    id: 'docs.seed',
    cli: ['docs', 'seed'],
    http: ['POST', '/api/docs/seed'],
    summary: '把仓库 desc / 看板 desc / 组内 note 字符串播种成约定路径的 md（缺省预览，--apply 执行；幂等）',
    input: docsSeedInput,
    render: renderSeed,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return (ctx.apply ? seed.seedApply() : seed.seedPlan());
  
  }
}
