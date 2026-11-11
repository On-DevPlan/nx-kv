// board.assign —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.assign 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  board: z.string().optional().describe("目标看板 id / key / 名称"),
  before: z.string().optional().describe("插到这张卡片之前（按 key）"),
  remove: z.boolean().optional().describe("移出：带 --board 从该板移出，不带则从所有看板移出"),
});

export class BoardAssignAction extends ActionBase<typeof input> {
  @action({
    id: 'board.assign',
    cli: ['board', 'assign'],
    http: ['POST', '/api/boards/assign'],
    summary: '把仓库聚合进看板（可同时在多个看板；--remove 移出；--before 插位；仓库给 id / key / 路径）',
    args: ['id'],
    input,
    render: (d: any) => (d.removed
      ? `已移出: ${d.key}（${d.count} 个看板）`
      : `${d.added ? '已聚合' : '已在（位次已调）'}: ${d.key} → ${d.board}`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.assignRepo(ctx);
  
  }
}
