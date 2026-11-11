// board.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardAddInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardAddAction extends ActionBase {
  @action({
    id: 'board.add',
    cli: ['board', 'add'],
    http: ['POST', '/api/boards'],
    summary: '新建看板（主题容器）',
    args: ['name'],
    input: boardAddInput,
    render: (b: any) => `已新建看板: ${b.name}`,
  })
  async add(ctx: any) {

      return boards.createBoard(ctx);
  
  }
}
