// localtask.wait —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { renderWait as _renderWait } from '../action-render.js';
const renderWait: any = _renderWait;

/** localtask.wait 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional(),
  summary: z.string().optional().describe("已废弃：当前现状不再收（面板上没有对应输入界面）"),
  timeout: z.number().optional().describe("阻塞上限（秒）；缺省用页面配置（推荐 180，最大 600）"),
  'no-open': z.boolean().optional().describe("不自动打开浏览器（测试用）"),
  param: z.array(z.string()).optional().describe("外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取"),
});

export class LocaltaskWaitAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.wait',
    cli: ['localtask', 'wait'],
    http: null,
    summary: '针对某主题（按 cwd 目录名识别）阻塞等待用户回填（默认 3 分钟，最大 10 分钟）；本地空时自动领取全局共享池的任务',
    input,
    render: renderWait,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        // wait 编排已迁 tasktool/wait.js（任务工具语义归 tasktool；命令名不变）
        const { waitForTask } = await (import('../../tasktool/wait.js') as any);
        const { parseParams } = await (import('../../tasktool/params.js') as any);
        return waitForTask({
          cwd: ctx.cwd,
          timeoutSec: ctx.timeout,
          open: !ctx['no-open'],
          params: parseParams(ctx.param),
        });
    
  }
}
