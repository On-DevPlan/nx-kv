// localtask.closeMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.closeMany 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  status: z.string().optional().describe("done（标为完成，默认）或 cancelled（取消）"),
  summary: z.string().optional().describe("完成总结（status=done 时可选）"),
});

export class LocaltaskCloseManyAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.closeMany',
    cli: ['localtask', 'close-many'],
    http: ['POST', '/api/localtasks/items/close'],
    summary: '批量收口待领取任务（按 --ids，定位到 --cwd 主题或 --key）：不要求先领取；--status done 写完成总结，cancelled 只改状态；已领取/已完成跳过',
    input,
    render: (d: any) => {
      const done: any = d.closed.map((x: any) => `#${x.id}`).join(' ');
      const verb: any = d.closeStatus === 'cancelled' ? '取消' : '标为完成';
      const head: any = d.count
        ? `已在主题「${d.name}」${verb} ${d.count} 条待领取任务（${done}）`
        : `主题「${d.name}」没有可${verb}的待领取任务`;
      const skip: any = d.skipped.length
        ? `；跳过 ${d.skipped.map((x: any) => `#${x.id}(${x.status})`).join(' ')}`
        : '';
      const miss: any = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      return head + skip + miss;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.closeTasks({
          ids: ctx.ids,
          cwd: ctx.cwd,
          key: ctx.key,
          status: ctx.status,
          summary: ctx.summary,
        });
  
  }
}
