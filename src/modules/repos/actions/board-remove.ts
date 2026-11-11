// board.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardRemoveInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardRemoveAction extends ActionBase {
  @action({
    id: 'board.remove',
    cli: ['board', 'remove'],
    http: ['DELETE', '/api/boards/:id'],
    summary: '删看板（里面的仓库回到未分组，登记不动）',
    args: ['id'],
    input: boardRemoveInput,
    render: (d: any) => `已删除看板: ${d.removed}（${d.released} 个仓库回到未分组）`,
  })
  async remove(ctx: any) {

      return boards.removeBoard(ctx.id);
  
  }
}
