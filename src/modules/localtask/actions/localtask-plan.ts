// localtask.plan —— 任务临时草稿态（#126）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.plan 的入参契约（CLI 与 HTTP 共用）。 */
const input = z.object({
  id: z.number().describe('任务编号'),
  to: z.enum(['plan', 'pending']).optional().describe('plan=转成草稿（不进队列）；pending=转回正常待领取；缺省 plan'),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskPlanAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.plan',
    cli: ['localtask', 'plan'],
    http: ['PATCH', '/api/localtasks/plan'],
    summary: '临时草稿态：plan 不进队列（get/wait 都领不到），pending 转回正常待领取；只允许 pending ↔ plan 双向切换',
    input,
    render: (d: any) =>
      d.changed
        ? `已把 #${d.id} @ ${d.name} 从 ${d.from} 切成 ${d.to}${d.to === 'plan' ? '（草稿，不进队列）' : '（回到待领取）'}`
        : `#${d.id} 已经是 ${d.to}，无需改动`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.setPlanStatus({
      id: ctx.id,
      to: ctx.to || 'plan',
      cwd: ctx.cwd,
      key: ctx.key,
    });
  }
}
