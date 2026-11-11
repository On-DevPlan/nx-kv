// localtask.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderOverview as _renderOverview } from '../action-render.js';
const service: any = serviceNs;
const renderOverview: any = _renderOverview;

/** localtask.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class LocaltaskListAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.list',
    cli: ['localtask', 'list'],
    http: ['GET', '/api/localtasks'],
    summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
    input,
    render: renderOverview,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listTasks();
  
  }
}
