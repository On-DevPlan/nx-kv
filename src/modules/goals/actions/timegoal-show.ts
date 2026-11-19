// timegoal.show —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../timegoal.js';
import { badInput as _badInput } from '../../../core/errors.js';
import { renderShow } from '../support.js';
const service: any = serviceNs;
const badInput: any = _badInput;

/** timegoal.show 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional().describe("工作目录（与 --task 二选一）"),
  task: z.string().optional().describe("任务级 goal key（task:<topicKey>:<taskId>）"),
});

export class TimegoalShowAction extends ActionBase<typeof input> {
  @action({
    id: 'timegoal.show',
    cli: ['timegoal', 'show'],
    http: ['GET', '/api/timegoals'],
    summary: '查看当前 timegoal（不算时间）：--cwd 目录级，--task 任务级（key 在领取交付里自带）',
    input,
    render: renderShow,
  })
  override async run(ctx: ActionInput<this['_input']>) {

          if (!ctx.cwd && !ctx.task) throw badInput('请给 --cwd <工作目录> 或 --task <任务goal key>');
          return ctx.task ? service.showGoalByKey(ctx.task) : service.showTimegoal({ cwd: ctx.cwd });
      
  }
}
