// repo.import.diff —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as transferNs from '../transfer.js';
import { readLayout as _readLayout } from '../cli/render.js';
const transfer: any = transferNs;
const readLayout: any = _readLayout;

/** repo.import.diff 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  file: z.string().optional(),
  json: z.string().optional().describe("（面板）直接给布局 JSON"),
});

export class RepoImportDiffAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.import.diff',
    cli: ['repo', 'import', '--diff'],
    http: ['POST', '/api/repos/import/diff'],
    summary: '导入前的差异检查：逐条给出 新增/有差异/一致/本地未拥有（零副作用）',
    args: ['file'],
    input,
    render: (d: any) => transfer.renderDiff(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { json, docsFiles } = await readLayout(ctx);
        return transfer.diffImport(json, docsFiles);
    
  }
}
