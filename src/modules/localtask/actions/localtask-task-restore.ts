// localtask.task.restore —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskTaskRestoreInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskTaskRestoreAction extends ActionBase {
  @action({
    id: 'localtask.task.restore',
    cli: ['localtask', 'task', 'restore'],
    http: ['POST', '/api/localtasks/tasks/restore'],
    summary: '恢复一条被删除（软删除）的任务（撤销删除）',
    input: localtaskTaskRestoreInput,
    render: (d: any) =>
      d.restored
        ? `已恢复主题「${d.name}」#${d.task.id}: ${d.task.text}`
        : `主题「${d.name}」#${d.task.id} 本来就没被删除，无需恢复。`,
  })
  async restore(ctx: any) {

      return service.restoreTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
