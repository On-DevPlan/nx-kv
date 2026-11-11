// board.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardPruneInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardPruneAction extends ActionBase {
  @action({
    id: 'board.prune',
    cli: ['board', 'prune'],
    http: ['POST', '/api/boards/prune'],
    summary: '清理占位成员：组里引用、本机没登记且没有远程地址的仓库（默认预览，--apply 落盘；带 remote 的加 --all 才清）',
    input: boardPruneInput,
    render: (d: any) => {
      const lines: any = [`${d.apply ? '已清理' : '可清理'} ${d.total} 个占位成员${d.apply ? '' : '（未落盘）'}`];
      for (const it of d.items) lines.push(`  ${it.name}  ${it.key}  —— 组「${it.board}」${it.remote ? '（有 remote，--all 才会清）' : '（无来源）'}`);
      if (!d.apply && d.total) lines.push('', '落盘: nx-kv board prune --apply');
      return lines.join('\n');
    },
  })
  async prune(ctx: any) {

      return boards.prunePlaceholders({ board: ctx.board, all: !!ctx.all, apply: !!ctx.apply });
  
  }
}
