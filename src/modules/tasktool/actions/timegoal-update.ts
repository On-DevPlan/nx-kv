// timegoal.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { timegoalUpdateInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { renderUpdate } from '../support.js';
const service: any = serviceNs;

export class TimegoalUpdateAction extends ActionBase {
  @action({
    id: 'timegoal.update',
    cli: ['timegoal', 'update'],
    http: ['PATCH', '/api/timegoals'],
    summary: '更新本目录 timegoal 的提示词（可选同时改时长，--duration；保留起点，不重置计时）',
    input: timegoalUpdateInput,
    render: renderUpdate,
  })
  async update(ctx: any) {

      return service.updateTimegoal({ cwd: ctx.cwd, prompt: ctx.prompt, durationSec: ctx.duration });
  
  }
}
