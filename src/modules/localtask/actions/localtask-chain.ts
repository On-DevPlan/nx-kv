// localtask.chain —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskChainInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderChain as _renderChain } from '../action-render.js';
const service: any = serviceNs;
const renderChain: any = _renderChain;

export class LocaltaskChainAction extends ActionBase {
  @action({
    id: 'localtask.chain',
    cli: ['localtask', 'chain'],
    http: ['GET', '/api/localtasks/chain'],
    summary: '查一条任务的链：history 节点（origin/reopen/comment/current）+ 旧 forkOf 祖先/子任务；面板点节点可旁路查看正文',
    input: localtaskChainInput,
    render: renderChain,
  })
  async chain(ctx: any) {

      return service.taskChain({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
  
  }
}
