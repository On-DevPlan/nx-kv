// timegoal.clear —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { timegoalClearInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { renderClear } from '../support.js';
const service: any = serviceNs;

export class TimegoalClearAction extends ActionBase<typeof timegoalClearInput> {
  @action({
    id: 'timegoal.clear',
    cli: ['timegoal', 'clear'],
    http: ['DELETE', '/api/timegoals'],
    summary: '清空本目录 timegoal（无则 no_goal，不抛错）',
    input: timegoalClearInput,
    render: renderClear,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.clearTimegoal({ cwd: ctx.cwd });
  
  }
}
