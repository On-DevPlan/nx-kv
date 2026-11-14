// localtask.claim —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { renderWait as _renderWait } from '../action-render.js';
const renderWait: any = _renderWait;

/** localtask.claim 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional(),
  timeout: z.number().optional().describe("阻塞上限（秒）：显式给定时，即使项目没开「持续 get」也会阻塞这么久（= 旧的 localtask wait）"),
  'no-open': z.boolean().optional().describe("不自动打开浏览器（测试用）"),
  param: z.array(z.string()).optional().describe("外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取"),
});

export class LocaltaskClaimAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.claim',
    cli: ['localtask', 'get'],
    http: ['POST', '/api/localtasks/claim'],
    summary: '领取任务：有任务立即领（含任务级 timegoal 的 check 指令）；没任务默认立即返回 timeout，项目开启「持续 get」后自动唤起阻塞窗口等人回填',
    input,
    render: renderWait,
  })
  override async run(ctx: ActionInput<this['_input']>, meta: ActionRunMeta = {}) {

        const { getTask } = await (import('../../tasktool/get.js') as any);
        const { parseParams } = await (import('../../tasktool/params.js') as any);
        // HTTP：不阻塞、不开浏览器（面板/脚本调用不该挂住请求，也不该弹窗）
        const viaHttp: any = !!(meta && meta.transport === 'http');
        return getTask({
          cwd: ctx.cwd,
          timeoutSec: viaHttp ? undefined : ctx.timeout,
          open: viaHttp ? false : !ctx['no-open'],
          instant: viaHttp ? true : undefined,
          params: parseParams(ctx.param),
        });
    
  }
}
