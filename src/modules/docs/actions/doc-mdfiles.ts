// doc.mdfiles —— 列出已登记的本地 md 文件（kind=mdfile）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listDocMdfiles } from '../mdfile.js';

const input = z.object({
  missing: z.boolean().optional().describe('只看已失效（missing_at 非空）的行'),
});

export class DocMdfilesAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.mdfiles',
    cli: ['docs', 'mdfiles'],
    http: ['GET', '/api/docs/mdfiles'],
    summary: '列出已登记的本地 md 文件（mdfile 附件；--missing 只看失效行）',
    input,
    render: (rows: Array<{ id: string; name: string; absPath: string; missing: boolean; missingAt: number | null }>) => {
      if (!rows.length) return '没有 mdfile 附件';
      return rows
        .map((r) => `${r.missing ? '!' : '·'} ${r.id}  ${r.name}  ${r.absPath}` +
          (r.missingAt ? `  (missing since ${new Date(r.missingAt).toISOString()})` : ''))
        .join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return listDocMdfiles(ctx);
  }
}
