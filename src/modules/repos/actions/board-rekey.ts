// board.rekey —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { boardRekeyInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardRekeyAction extends ActionBase<typeof boardRekeyInput> {
  @action({
    id: 'board.rekey',
    cli: ['board', 'rekey'],
    http: ['POST', '/api/boards/rekey'],
    summary: '把组里的占位 key 重绑到本机仓库（关系改、登记不动；组内描述与文档绑定跟着搬）',
    args: ['from'],
    input: boardRekeyInput,
    render: (d: any) => {
      const where: any = d.boards.length > 1 ? `${d.boards.length} 个看板（${d.boards.join('、')}）` : `组「${d.boardName}」`;
      return `已重绑 ${d.from} → ${d.to}（${where}${d.merged ? '，与已有成员合并' : ''}${d.movedNote ? '，组内描述已跟随' : ''}${d.relinked ? `，${d.relinked} 条绑定已改指` : ''}）`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.rekeyMember({ from: ctx.from, to: ctx.to, board: ctx.board });
  
  }
}
