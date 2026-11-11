// localtask.reorder —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.reorder 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("要移动的任务编号"),
  beforeId: z.number().optional().describe("插到该编号之前（与 afterId 二选一）"),
  afterId: z.number().optional().describe("插到该编号之后（与 beforeId 二选一）"),
  'before-id': z.number().optional().describe("同 --beforeId（连字符写法）"),
  'after-id': z.number().optional().describe("同 --afterId（连字符写法）"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskReorderAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.reorder',
    cli: ['localtask', 'reorder'],
    http: ['PATCH', '/api/localtasks/reorder'],
    summary: '调整待领取任务优先级（--id <编号> 移到 --before-id <编号> 前或 --after-id <编号> 后）',
    input,
    render: (d: any) => {
      const order: any = d.topic.tasks.filter((x: any) => x.status === 'pending').map((x: any) => `#${x.id}`);
      return `主题「${d.name}」待领取顺序：${order.join(' -> ') || '（无待领取）'}`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.reorderTasks({
          id: ctx.id,
          beforeId: ctx.beforeId !== undefined ? ctx.beforeId : ctx['before-id'],
          afterId: ctx.afterId !== undefined ? ctx.afterId : ctx['after-id'],
          cwd: ctx.cwd,
          key: ctx.key,
        });
  
  }
}
