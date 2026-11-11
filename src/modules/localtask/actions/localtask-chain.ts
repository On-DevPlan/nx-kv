// localtask.chain —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderChain as _renderChain } from '../action-render.js';
const service: any = serviceNs;
const renderChain: any = _renderChain;

/** localtask.chain 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskChainAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.chain',
    cli: ['localtask', 'chain'],
    http: ['GET', '/api/localtasks/chain'],
    summary: '查一条任务的链：history 节点（origin/reopen/comment/current）+ 旧 forkOf 祖先/子任务；面板点节点可旁路查看正文',
    input,
    render: renderChain,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.taskChain({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
