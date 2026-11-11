// localtask.removeMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.removeMany 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  purge: z.boolean().optional().describe("彻底删除（不可恢复）；不加就是软删除"),
});

export class LocaltaskRemoveManyAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.removeMany',
    cli: ['localtask', 'remove-many'],
    http: ['DELETE', '/api/localtasks/items'],
    summary: '批量删除任务（按 --ids，定位到 --cwd 主题或 --key）：一次落盘，逐条软删除（可 restore 恢复）；缺失的编号不阻断其余删除',
    input,
    render: (d: any) => {
      const done: any = d.removed.map((x: any) => `#${x.id}`).join(' ');
      const head: any = d.count
        ? `${d.purged ? '已彻底删除' : '已删除'}主题「${d.name}」${d.count} 条（${done}）`
        : `主题「${d.name}」没有可删的任务`;
      const tail: any = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      const how: any = d.count && !d.purged ? '；可用 localtask task restore 恢复' : '';
      return head + tail + how;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeTasks({ ids: ctx.ids, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge });
  
  }
}
