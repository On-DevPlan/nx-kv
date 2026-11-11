// timegoal.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { timegoalSetInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { renderSet } from '../support.js';
const service: any = serviceNs;

export class TimegoalSetAction extends ActionBase<typeof timegoalSetInput> {
  @action({
    id: 'timegoal.set',
    cli: ['timegoal', 'set'],
    http: ['POST', '/api/timegoals'],
    summary: '为本目录设置/替换 timegoal：duration + 完整全局提示词（原文固化到 store）',
    input: timegoalSetInput,
    render: renderSet,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.setTimegoal({ cwd: ctx.cwd, durationSec: ctx.duration, prompt: ctx.prompt });
  
  }
}
