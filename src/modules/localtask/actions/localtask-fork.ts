// localtask.fork —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.fork 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskForkAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.fork',
    cli: ['localtask', 'fork'],
    http: ['POST', '/api/localtasks/fork'],
    summary: 'Fork 任务：复制正文内容为新任务，并把它挂到源任务的任务链下（保留评论/反馈链）；不继承时间目标与依赖',
    input,
    render: (d: any) =>
      `已 Fork #${d.from.id} → #${d.task.id} @ ${d.name}（内容复制 + 保留任务链；${d.delivered ? '已实时投递' : '待领取'}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.forkTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
