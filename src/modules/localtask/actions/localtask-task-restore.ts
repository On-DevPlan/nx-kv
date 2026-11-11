// localtask.task.restore —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.task.restore 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskTaskRestoreAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.task.restore',
    cli: ['localtask', 'task', 'restore'],
    http: ['POST', '/api/localtasks/tasks/restore'],
    summary: '恢复一条被删除（软删除）的任务（撤销删除）',
    input,
    render: (d: any) =>
      d.restored
        ? `已恢复主题「${d.name}」#${d.task.id}: ${d.task.text}`
        : `主题「${d.name}」#${d.task.id} 本来就没被删除，无需恢复。`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.restoreTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
