// localtask.events —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.events 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional().describe("工作目录过滤（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key 过滤（与 --cwd 二选一）"),
  timeout: z.number().optional().describe("最多监听多少秒后自动结束（默认不限）"),
  limit: z.number().optional().describe("最多输出多少条事件后自动结束（默认不限）"),
});

export class LocaltaskEventsAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.events',
    cli: ['localtask', 'events'],
    http: ['GET', '/api/localtasks/events'],
    summary: '等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接）',
    input,
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
