// timegoal.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../timegoal.js';
import { renderUpdate } from '../support.js';
const service: any = serviceNs;

/** timegoal.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
  prompt: z.string().describe("新版提示词（≤20000 字）"),
  duration: z.string().optional().describe("同时改时长（10800 / 5h / 90m / 2d）；省略则时长不变"),
});

export class TimegoalUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'timegoal.update',
    cli: ['timegoal', 'update'],
    http: ['PATCH', '/api/timegoals'],
    summary: '更新本目录 timegoal 的提示词（可选同时改时长，--duration；保留起点，不重置计时）',
    input,
    render: renderUpdate,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.updateTimegoal({ cwd: ctx.cwd, prompt: ctx.prompt, durationSec: ctx.duration });
  
  }
}
