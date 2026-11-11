// localtask.events —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { localtaskEventsInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskEventsAction extends ActionBase<typeof localtaskEventsInput> {
  @action({
    id: 'localtask.events',
    cli: ['localtask', 'events'],
    http: ['GET', '/api/localtasks/events'],
    summary: '等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接）',
    input: localtaskEventsInput,
    stream: true,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {
    // stream：req/res/url 由 ApiRouter 在 zod parse 之后塞进 input.__raw
    //（运行时注入，不在公共契约 schema 里——HTTP 分支必有，这里局部展开让它可见）
    const raw = ctx as typeof ctx & { __raw: { req: unknown; res: unknown; url: unknown } };
    return opts && opts.transport === 'http'
        ? service.streamEventsSSE(raw.__raw.req, raw.__raw.res, { cwd: ctx.cwd, key: ctx.key })
          : service.streamEventsNDJSON({
              cwd: ctx.cwd,
              key: ctx.key,
              timeoutSec: ctx.timeout,
              limit: ctx.limit,
            });
  
  }
}
