// board.import —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as boardsNs from '../boards.js';
import { badInput as _badInput } from '../../../core/errors.js';
const boards: any = boardsNs;
const badInput: any = _badInput;

/** board.import 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  file: z.string().optional(),
});

export class BoardImportAction extends ActionBase<typeof input> {
  @action({
    id: 'board.import',
    cli: ['board', 'import'],
    http: ['POST', '/api/boards/import'],
    summary: '导入看板 JSON（一个看板 = 一个主题；按 path/name 匹配已登记仓库）',
    args: ['file'],
    input,
    render: (d: any) => {
      const lines: any = [`新建 ${d.created} 个看板，合并 ${d.merged} 个，匹配仓库 ${d.matched} 个`];
      if (d.unmatched.length) {
        lines.push('未匹配（登记里找不到，未导入）:');
        for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry}`);
      }
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

        // json 不在 schema 里，zod parse 会剥掉未声明键——此分支恒为空串（#177 暴露；
        // CLI --file 与生成的 client 都只发已声明键，行为不受影响）。
        // 面板「粘贴 JSON」要走通，需把 json 声明进 schema。
        let json: any = typeof (ctx as Record<string, unknown>).json === 'string'
          ? (ctx as Record<string, unknown>).json
          : '';
        if (!json && ctx.file) {
          const { readFileSync } = await import('node:fs');
          json = readFileSync(ctx.file === '-' ? 0 : ctx.file, 'utf8');
        }
        if (!json) throw badInput('请给看板 JSON 文件路径（- 读 stdin），或在面板里粘贴 JSON');
        return boards.importBoards({ json });
    
  }
}
