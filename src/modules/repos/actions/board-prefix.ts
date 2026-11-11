// board.prefix —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { boardPrefixInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardPrefixAction extends ActionBase<typeof boardPrefixInput> {
  @action({
    id: 'board.prefix',
    cli: ['board', 'prefix'],
    http: ['POST', '/api/boards/prefix'],
    summary: '按前缀归组：把名字以 <prefix> 开头的仓库一次性挂进看板（--board 给目标看板；不给就按前缀名自动建同名看板）',
    args: ['prefix'],
    input: boardPrefixInput,
    render: (d: any) =>
      `已把「${d.prefix}*」的 ${d.added} 个仓库挂进看板「${d.boardName}」` +
      `${d.boardCreated ? '（已自动新建该看板）' : ''}，看板现有 ${d.total} 个成员`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.applyPrefixGroup(ctx);
  
  }
}
