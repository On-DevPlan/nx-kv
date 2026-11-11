// localtask.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderOverview as _renderOverview } from '../action-render.js';
const service: any = serviceNs;
const renderOverview: any = _renderOverview;

export class LocaltaskListAction extends ActionBase<typeof localtaskListInput> {
  @action({
    id: 'localtask.list',
    cli: ['localtask', 'list'],
    http: ['GET', '/api/localtasks'],
    summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
    input: localtaskListInput,
    render: renderOverview,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listTasks();
  
  }
}
