// localtask.closeMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskCloseManyInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskCloseManyAction extends ActionBase<typeof localtaskCloseManyInput> {
  @action({
    id: 'localtask.closeMany',
    cli: ['localtask', 'close-many'],
    http: ['POST', '/api/localtasks/items/close'],
    summary: '批量收口待领取任务（按 --ids，定位到 --cwd 主题或 --key）：不要求先领取；--status done 写完成总结，cancelled 只改状态；已领取/已交付跳过',
    input: localtaskCloseManyInput,
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
