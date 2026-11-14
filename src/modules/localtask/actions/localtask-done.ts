// localtask.done —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { doneView } from '../contract-views.js';
const service: any = serviceNs;

/** localtask.done 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  summary: z.string().describe("完成总结（记为本轮终态 + timegoal 日志）"),
});

export class LocaltaskDoneAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.done',
    cli: ['localtask', 'done'],
    http: ['POST', '/api/localtasks/done'],
    summary: '标记任务完成：--summary 完成总结必填；带时间目标的任务未到点会被拒绝（blocked），到点自动记录最终 check',
    input,
    output: doneView,
    render: (d: any) => {
      if (d.status === 'blocked') {
        // #90：未到点的拦截文案来自可配置的 doneguard 模板（d.guard）；模板空/渲染失败
        // 才退回内置 hint 的一行式兜底。
        if (d.reason === 'not_claimed') return `[blocked] 任务 #${d.id} 暂不能标完成：${d.hint}`;
        const head: any = `时间未到（剩 ${d.remainingHuman || Math.round((d.remainingSec || 0) / 60) + ' 分钟'}，截止 ${d.deadline}）`;
        if (d.guard) return `[blocked] 任务 #${d.id} 暂不能标完成。\n${d.guard}\n（${head}）`;
        return `[blocked] 任务 #${d.id} 暂不能标完成：${head}——${d.hint}`;
      }
      if (d.already) return `任务 #${d.id} 之前已完成（${d.completedAt}），无需重复标记。`;
      const goal: any = d.goal && d.goal.recorded ? '（最终 check 已记录）' : '';
      return `已标记完成: #${d.id} @ ${d.name}（${d.completedAt}）${goal}`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.completeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, summary: ctx.summary });
  
  }
}
