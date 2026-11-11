// board.export —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.export 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class BoardExportAction extends ActionBase<typeof input> {
  @action({
    id: 'board.export',
    cli: ['board', 'export'],
    http: ['GET', '/api/boards/export'],
    summary: '导出看板 JSON（可回灌给 board import）',
    input,
    render: (d: any) => JSON.stringify(d, null, 2),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return boards.exportBoards();
  
  }
}
