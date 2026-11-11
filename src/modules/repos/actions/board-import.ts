// board.import —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardImportInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
import { badInput as _badInput } from '../../../core/errors.js';
const boards: any = boardsNs;
const badInput: any = _badInput;

export class BoardImportAction extends ActionBase {
  @action({
    id: 'board.import',
    cli: ['board', 'import'],
    http: ['POST', '/api/boards/import'],
    summary: '导入看板 JSON（一个看板 = 一个主题；按 path/name 匹配已登记仓库）',
    args: ['file'],
    input: boardImportInput,
    render: (d: any) => {
      const lines: any = [`新建 ${d.created} 个看板，合并 ${d.merged} 个，匹配仓库 ${d.matched} 个`];
      if (d.unmatched.length) {
        lines.push('未匹配（登记里找不到，未导入）:');
        for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry}`);
      }
      return lines.join('\n');
    },
  })
  async import(ctx: any) {

        let json: any = typeof ctx.json === 'string' ? ctx.json : '';
        if (!json && ctx.file) {
          const { readFileSync } = await import('node:fs');
          json = readFileSync(ctx.file === '-' ? 0 : ctx.file, 'utf8');
        }
        if (!json) throw badInput('请给看板 JSON 文件路径（- 读 stdin），或在面板里粘贴 JSON');
        return boards.importBoards({ json });
    
  }
}
