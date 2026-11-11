// board.note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.note 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  board: z.string().describe("看板 id / key / 名称"),
  note: z.string().optional().describe("组内描述（多行可含关键路径/关键词；留空 = 清除）"),
});

export class BoardNoteAction extends ActionBase<typeof input> {
  @action({
    id: 'board.note',
    cli: ['board', 'note'],
    http: ['POST', '/api/boards/note'],
    summary: '写/清组内描述：仓库在看板里的角色与配合关系（--note 留空 = 清除；仓库给 id / key / 绝对路径）',
    args: ['id'],
    input,
    render: (d: any) => (d.note
      ? `已写组内描述: ${d.name} @ 「${d.boardName}」`
      : `已清除组内描述: ${d.name} @ 「${d.boardName}」`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.setBoardRepoNote({ id: ctx.id, board: ctx.board, note: ctx.note });
  
  }
}
