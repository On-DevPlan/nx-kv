// repo.import.diff —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoImportDiffInput } from '../schemas.js';
import * as transferNs from '../transfer.js';
import { readLayout as _readLayout } from '../cli/render.js';
const transfer: any = transferNs;
const readLayout: any = _readLayout;

export class RepoImportDiffAction extends ActionBase<typeof repoImportDiffInput> {
  @action({
    id: 'repo.import.diff',
    cli: ['repo', 'import', '--diff'],
    http: ['POST', '/api/repos/import/diff'],
    summary: '导入前的差异检查：逐条给出 新增/有差异/一致/本地未拥有（零副作用）',
    args: ['file'],
    input: repoImportDiffInput,
    render: (d: any) => transfer.renderDiff(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { json, docsFiles } = await readLayout(ctx);
        return transfer.diffImport(json, docsFiles);
    
  }
}
