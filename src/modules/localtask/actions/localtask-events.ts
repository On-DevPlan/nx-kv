// localtask.events —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskEventsInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskEventsAction extends ActionBase {
  @action({
    id: 'localtask.events',
    cli: ['localtask', 'events'],
    http: ['GET', '/api/localtasks/events'],
    summary: '等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接）',
    input: localtaskEventsInput,
    stream: true,
  })
  async events(ctx: any, opts: any = {}) {

      return opts && opts.transport === 'http'
          ? service.streamEventsSSE(ctx.__raw.req, ctx.__raw.res, { cwd: ctx.cwd, key: ctx.key })
          : service.streamEventsNDJSON({
              cwd: ctx.cwd,
              key: ctx.key,
              timeoutSec: ctx.timeout,
              limit: ctx.limit,
            });
  
  }
}
