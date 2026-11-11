// localtask.wait —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskWaitInput } from '../schemas.js';
import { renderWait as _renderWait } from '../action-render.js';
const renderWait: any = _renderWait;

export class LocaltaskWaitAction extends ActionBase {
  @action({
    id: 'localtask.wait',
    cli: ['localtask', 'wait'],
    http: null,
    summary: '针对某主题（按 cwd 目录名识别）阻塞等待用户回填（默认 3 分钟，最大 10 分钟）；本地空时自动领取全局共享池的任务',
    input: localtaskWaitInput,
    render: renderWait,
  })
  async wait(ctx: any) {

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
