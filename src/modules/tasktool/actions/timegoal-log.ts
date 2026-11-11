// timegoal.log —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { timegoalLogInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { fmtDur } from '../support.js';
const service: any = serviceNs;

export class TimegoalLogAction extends ActionBase {
  @action({
    id: 'timegoal.log',
    cli: ['timegoal', 'log'],
    http: ['GET', '/api/timegoals/log'],
    summary: '查看本目录 timegoal 的检查日志（每轮 check 的现状）',
    input: timegoalLogInput,
    render: (d: any) => {
        if (!d.hasGoal) return `[timegoal] 主题「${d.name}」暂无目标，也没有日志。`;
        if (!d.count) return `[timegoal] 主题「${d.name}」暂无检查日志。`;
        const lines: any = [`[timegoal] 主题「${d.name}」检查日志（保留 ${d.count} 条）:`];
        if (d.truncated) {
          lines.push(`  ⚠ 总共检查过 ${d.totalEntries} 轮，日志只保留最近 ${d.count} 条（更早的已丢弃）`);
        }
        for (const e of d.entries) {
          lines.push(`  ${e.checkedAt}  ${e.reached ? '已到点' : `剩 ${fmtDur(e.remainingSec)}`}`);
          lines.push(`      现状：${e.summary}`);
        }
        return lines.join('\n');
      },
  })
  async log(ctx: any) {

      return service.getTimegoalLog({ cwd: ctx.cwd });
  
  }
}
