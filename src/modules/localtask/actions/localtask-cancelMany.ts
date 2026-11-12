// localtask.cancelMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.cancelMany 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskCancelManyAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.cancelMany',
    cli: ['localtask', 'cancel-many'],
    http: ['POST', '/api/localtasks/items/cancel'],
    summary: '批量取消待领取任务（按 --ids，定位到 --cwd 主题或 --key）：只处理 pending，已领取/已完成/已取消跳过；取消为终态，原文留档',
    input,
    render: (d: any) => {
      const done: any = d.cancelled.map((x: any) => `#${x.id}`).join(' ');
      const head: any = d.count
        ? `已在主题「${d.name}」取消 ${d.count} 条待领取任务（${done}）`
        : `主题「${d.name}」没有可取消的待领取任务`;
      const skip: any = d.skipped.length
        ? `；跳过 ${d.skipped.map((x: any) => `#${x.id}(${x.status})`).join(' ')}`
        : '';
      const miss: any = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      return head + skip + miss;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.cancelTasks({ ids: ctx.ids, cwd: ctx.cwd, key: ctx.key });
  
  }
}
