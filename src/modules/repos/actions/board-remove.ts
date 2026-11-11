// board.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class BoardRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'board.remove',
    cli: ['board', 'remove'],
    http: ['DELETE', '/api/boards/:id'],
    summary: '删看板（里面的仓库回到未分组，登记不动）',
    args: ['id'],
    input,
    render: (d: any) => `已删除看板: ${d.removed}（${d.released} 个仓库回到未分组）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.removeBoard(ctx.id);
  
  }
}
