// timegoal.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { timegoalPruneInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
const service: any = serviceNs;

export class TimegoalPruneAction extends ActionBase {
  @action({
    id: 'timegoal.prune',
    cli: ['timegoal', 'prune'],
    http: ['POST', '/api/timegoals/prune'],
    summary: '彻底清除已到点 / 已归档的时间目标（到点本身已自动归档，这里是连归档区一起清）',
    input: timegoalPruneInput,
    render: (d: any) =>
        d.count
          ? `已彻底清除 ${d.count} 个到点/已归档的时间目标：\n` +
            d.removed.map((g: any) => `  - ${g.name}  ${g.cwd}  截止 ${g.deadline}`).join('\n')
          : '没有到点或已归档的时间目标（还在跑的不动手）。',
  })
  async prune(_ctx: any) {

      return service.pruneExpired();
  
  }
}
