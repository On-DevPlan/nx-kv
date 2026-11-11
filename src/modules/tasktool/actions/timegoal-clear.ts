// timegoal.clear —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../timegoal.js';
import { renderClear } from '../support.js';
const service: any = serviceNs;

/** timegoal.clear 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
});

export class TimegoalClearAction extends ActionBase<typeof input> {
  @action({
    id: 'timegoal.clear',
    cli: ['timegoal', 'clear'],
    http: ['DELETE', '/api/timegoals'],
    summary: '清空本目录 timegoal（无则 no_goal，不抛错）',
    input,
    render: renderClear,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.clearTimegoal({ cwd: ctx.cwd });
  
  }
}
