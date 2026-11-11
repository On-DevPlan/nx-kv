// timegoal.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { timegoalListInput } from '../schemas.js';
import * as serviceNs from '../timegoal.js';
import { renderList } from '../support.js';
const service: any = serviceNs;

export class TimegoalListAction extends ActionBase<typeof timegoalListInput> {
  @action({
    id: 'timegoal.list',
    cli: ['timegoal', 'list'],
    http: ['GET', '/api/timegoals/all'],
    summary: '列出所有有 timegoal 的目录（按截止升序；已到点的单列在归档区）',
    input: timegoalListInput,
    render: renderList,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listTimegoals();
  
  }
}
