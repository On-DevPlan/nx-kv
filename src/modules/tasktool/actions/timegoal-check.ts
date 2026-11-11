// timegoal.check —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { timegoalCheckInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { badInput as _badInput } from '../../../core/errors.js';
import { renderCheck } from '../support.js';
const service: any = serviceNs;
const badInput: any = _badInput;

export class TimegoalCheckAction extends ActionBase<typeof timegoalCheckInput> {
  @action({
    id: 'timegoal.check',
    cli: ['timegoal', 'check'],
    http: ['GET', '/api/timegoals/check'],
    summary: '时间运算 + 原文回显 prompt + 写入一次状态日志；每次必须提供当前现状 --summary',
    input: timegoalCheckInput,
    render: renderCheck,
  })
  override async run(ctx: ActionInput<this['_input']>) {

          if (!ctx.cwd && !ctx.task) throw badInput('请给 --cwd <工作目录> 或 --task <任务goal key>');
          return ctx.task
            ? service.checkGoalByKey(ctx.task, { summary: ctx.summary })
            : service.checkTimegoal({ cwd: ctx.cwd, summary: ctx.summary });
      
  }
}
