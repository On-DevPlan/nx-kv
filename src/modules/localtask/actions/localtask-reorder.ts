// localtask.reorder —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskReorderInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskReorderAction extends ActionBase {
  @action({
    id: 'localtask.reorder',
    cli: ['localtask', 'reorder'],
    http: ['PATCH', '/api/localtasks/reorder'],
    summary: '调整待领取任务优先级（--id <编号> 移到 --before-id <编号> 前或 --after-id <编号> 后）',
    input: localtaskReorderInput,
    render: (d: any) => {
      const order: any = d.topic.tasks.filter((x: any) => x.status === 'pending').map((x: any) => `#${x.id}`);
      return `主题「${d.name}」待领取顺序：${order.join(' -> ') || '（无待领取）'}`;
    },
  })
  async reorder(ctx: any) {

      return service.reorderTasks({
          id: ctx.id,
          beforeId: ctx.beforeId !== undefined ? ctx.beforeId : ctx['before-id'],
          afterId: ctx.afterId !== undefined ? ctx.afterId : ctx['after-id'],
          cwd: ctx.cwd,
          key: ctx.key,
        });
  
  }
}
