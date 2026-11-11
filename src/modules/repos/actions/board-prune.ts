// board.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

/** board.prune 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  board: z.string().optional().describe("只清这张看板（省略 = 全部看板）"),
  all: z.boolean().optional().describe("连带远程地址的占位一起清（它们本来可以 clone 回来）"),
  apply: z.boolean().optional().describe("真正落盘（省略 = 只预览）"),
});

export class BoardPruneAction extends ActionBase<typeof input> {
  @action({
    id: 'board.prune',
    cli: ['board', 'prune'],
    http: ['POST', '/api/boards/prune'],
    summary: '清理占位成员：组里引用、本机没登记且没有远程地址的仓库（默认预览，--apply 落盘；带 remote 的加 --all 才清）',
    input,
    render: (d: any) => {
      const lines: any = [`${d.apply ? '已清理' : '可清理'} ${d.total} 个占位成员${d.apply ? '' : '（未落盘）'}`];
      for (const it of d.items) lines.push(`  ${it.name}  ${it.key}  —— 组「${it.board}」${it.remote ? '（有 remote，--all 才会清）' : '（无来源）'}`);
      if (!d.apply && d.total) lines.push('', '落盘: nx-kv board prune --apply');
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return boards.prunePlaceholders({ board: ctx.board, all: !!ctx.all, apply: !!ctx.apply });
  
  }
}
