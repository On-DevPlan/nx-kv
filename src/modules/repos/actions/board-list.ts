// board.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardListInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
import { renderBoardList as _renderBoardList } from '../cli/render.js';
const boards: any = boardsNs;
const renderBoardList: any = _renderBoardList;

export class BoardListAction extends ActionBase {
  @action({
    id: 'board.list',
    cli: ['board', 'list'],
    http: ['GET', '/api/boards'],
    summary: '看板清单：每个主题里有哪些仓库、各自的一句话描述',
    input: boardListInput,
    render: renderBoardList,
  })
  async list(_ctx: any) {

      return boards.listBoards();
  
  }
}
