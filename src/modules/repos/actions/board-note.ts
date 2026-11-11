// board.note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardNoteInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardNoteAction extends ActionBase {
  @action({
    id: 'board.note',
    cli: ['board', 'note'],
    http: ['POST', '/api/boards/note'],
    summary: '写/清组内描述：仓库在看板里的角色与配合关系（--note 留空 = 清除；仓库给 id / key / 绝对路径）',
    args: ['id'],
    input: boardNoteInput,
    render: (d: any) => (d.note
      ? `已写组内描述: ${d.name} @ 「${d.boardName}」`
      : `已清除组内描述: ${d.name} @ 「${d.boardName}」`),
  })
  async note(ctx: any) {

      return boards.setBoardRepoNote({ id: ctx.id, board: ctx.board, note: ctx.note });
  
  }
}
