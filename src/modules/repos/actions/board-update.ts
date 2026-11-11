// board.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { boardUpdateInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardUpdateAction extends ActionBase<typeof boardUpdateInput> {
  @action({
    id: 'board.update',
    cli: ['board', 'update'],
    http: ['PATCH', '/api/boards/:id'],
    summary: '改看板名称 / 描述',
    args: ['id'],
    input: boardUpdateInput,
    render: (b: any) => `已更新看板: ${b.name}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.updateBoard(ctx.id, ctx);
  
  }
}
