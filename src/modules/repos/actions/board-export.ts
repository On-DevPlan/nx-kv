// board.export —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardExportInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardExportAction extends ActionBase {
  @action({
    id: 'board.export',
    cli: ['board', 'export'],
    http: ['GET', '/api/boards/export'],
    summary: '导出看板 JSON（可回灌给 board import）',
    input: boardExportInput,
    render: (d: any) => JSON.stringify(d, null, 2),
  })
  async export(_ctx: any) {

      return boards.exportBoards();
  
  }
}
