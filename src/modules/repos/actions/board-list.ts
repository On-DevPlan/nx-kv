// board.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
import { renderBoardList as _renderBoardList } from '../cli/render.js';
const boards: any = boardsNs;
const renderBoardList: any = _renderBoardList;

/** board.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class BoardListAction extends ActionBase<typeof input> {
  @action({
    id: 'board.list',
    cli: ['board', 'list'],
    http: ['GET', '/api/boards'],
    summary: '看板清单：每个主题里有哪些仓库、各自的一句话描述',
    input,
    render: renderBoardList,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return boards.listBoards();
  
  }
}
