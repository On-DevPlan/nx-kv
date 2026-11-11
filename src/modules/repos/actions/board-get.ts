// board.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { boardGetInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
import { renderBoard as _renderBoard } from '../cli/render.js';
const boards: any = boardsNs;
const renderBoard: any = _renderBoard;

export class BoardGetAction extends ActionBase<typeof boardGetInput> {
  @action({
    id: 'board.get',
    cli: ['board', 'get'],
    http: ['GET', '/api/boards/:id'],
    summary: '查看单个看板（含成员仓库与描述）',
    args: ['id'],
    input: boardGetInput,
    render: renderBoard,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.getBoard(ctx.id);
  
  }
}
