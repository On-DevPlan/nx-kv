// board.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
import { renderBoard as _renderBoard } from '../cli/render.js';
const boards: any = boardsNs;
const renderBoard: any = _renderBoard;

/** board.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class BoardGetAction extends ActionBase<typeof input> {
  @action({
    id: 'board.get',
    cli: ['board', 'get'],
    http: ['GET', '/api/boards/:id'],
    summary: '查看单个看板（含成员仓库与描述）',
    args: ['id'],
    input,
    render: renderBoard,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.getBoard(ctx.id);
  
  }
}
