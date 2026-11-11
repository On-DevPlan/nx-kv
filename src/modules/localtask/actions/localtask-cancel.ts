// localtask.cancel —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderCancel as _renderCancel } from '../action-render.js';
const service: any = serviceNs;
const renderCancel: any = _renderCancel;

/** localtask.cancel 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional().describe("工作目录（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key（与 --cwd 二选一）"),
});

export class LocaltaskCancelAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.cancel',
    cli: ['localtask', 'cancel'],
    http: ['POST', '/api/localtasks/cancel'],
    summary: '关闭某主题的等待：阻塞中的 wait 立即收尾（与超时同一出口，带 cancelled 标记；不删主题与任务）',
    input,
    render: renderCancel,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.cancelWait({ cwd: ctx.cwd, key: ctx.key });
  
  }
}
