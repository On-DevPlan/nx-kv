// board.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  name: z.string(),
  desc: z.string().optional(),
});

export class BoardAddAction extends ActionBase<typeof input> {
  @action({
    id: 'board.add',
    cli: ['board', 'add'],
    http: ['POST', '/api/boards'],
    summary: '新建看板（主题容器）',
    args: ['name'],
    input,
    render: (b: any) => `已新建看板: ${b.name}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.createBoard(ctx);
  
  }
}
