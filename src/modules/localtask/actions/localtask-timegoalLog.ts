// localtask.timegoalLog —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskTimegoalLogInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskTimegoalLogAction extends ActionBase<typeof localtaskTimegoalLogInput> {
  @action({
    id: 'localtask.timegoalLog',
    cli: ['localtask', 'timegoal-log'],
    http: ['GET', '/api/localtasks/timegoal-log'],
    summary: '查看任务级时间目标的每轮 check 记录（时间、已用/剩余、是否到点、当轮总结）',
    input: localtaskTimegoalLogInput,
    render: (d: any) => {
      if (!d.hasGoal) return `#${d.seq || ''} 没有任务级时间目标记录。`;
      const lines: any = [`#${d.seq} 时间目标 check 记录 ${d.count} 轮（${d.duration} · ${d.startedAt} → ${d.deadline}）`];
      if (!d.count) lines.push('  （还没有 check 记录）');
      d.entries.forEach((e: any, i: any) => {
        lines.push(
          `  R${i + 1}  ${e.checkedAt}  已用 ${e.elapsedSec}s · 剩余 ${e.remainingSec}s${e.reached ? ' · 已到点' : ''}`,
        );
        if (e.summary) lines.push(`      ${e.summary}`);
      });
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const topicKey: any = ctx.key || service.normalizeCwd(ctx.cwd).key;
        const { getTaskGoalLog } = await (import('../../tasktool/timegoal.js') as any);
        return getTaskGoalLog({ topicKey, taskId: ctx.id });
    
  }
}
