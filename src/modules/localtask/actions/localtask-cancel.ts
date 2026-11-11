// localtask.cancel —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskCancelInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderCancel as _renderCancel } from '../action-render.js';
const service: any = serviceNs;
const renderCancel: any = _renderCancel;

export class LocaltaskCancelAction extends ActionBase<typeof localtaskCancelInput> {
  @action({
    id: 'localtask.cancel',
    cli: ['localtask', 'cancel'],
    http: ['POST', '/api/localtasks/cancel'],
    summary: '关闭某主题的等待：阻塞中的 wait 立即收尾（与超时同一出口，带 cancelled 标记；不删主题与任务）',
    input: localtaskCancelInput,
    render: renderCancel,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.cancelWait({ cwd: ctx.cwd, key: ctx.key });
  
  }
}
