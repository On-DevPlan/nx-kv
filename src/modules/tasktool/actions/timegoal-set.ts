// timegoal.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../timegoal.js';
import { renderSet } from '../support.js';
const service: any = serviceNs;

/** timegoal.set 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
  duration: z.string().describe("持续时长（10800 秒 / 5h / 90m / 2d / 5小时）"),
  prompt: z.string().describe("完整全局提示词（≤20000 字，每轮 check 会原文回显）"),
});

export class TimegoalSetAction extends ActionBase<typeof input> {
  @action({
    id: 'timegoal.set',
    cli: ['timegoal', 'set'],
    http: ['POST', '/api/timegoals'],
    summary: '为本目录设置/替换 timegoal：duration + 完整全局提示词（原文固化到 store）',
    input,
    render: renderSet,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.setTimegoal({ cwd: ctx.cwd, durationSec: ctx.duration, prompt: ctx.prompt });
  
  }
}
