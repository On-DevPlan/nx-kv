// localtask.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  purge: z.boolean().optional().describe("彻底删除（不可恢复）；不加就是软删除，可 restore 回来"),
});

export class LocaltaskRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.remove',
    cli: ['localtask', 'remove'],
    http: ['DELETE', '/api/localtasks/item'],
    summary: '删除一条任务（按 --id，定位到 --cwd 主题或 --key）；删除是**可恢复**的（软删除），加 --purge 彻底清除',
    input,
    render: (d: any) =>
      d.purged
        ? `已彻底删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（不可恢复）`
        : `已删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（可用 localtask task restore 恢复）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge });
  
  }
}
