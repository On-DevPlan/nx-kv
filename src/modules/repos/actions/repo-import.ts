// repo.import —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoImportInput } from '../schemas.js';
import * as transferNs from '../transfer.js';
import { readLayout as _readLayout } from '../cli/render.js';
const transfer: any = transferNs;
const readLayout: any = _readLayout;

export class RepoImportAction extends ActionBase<typeof repoImportInput> {
  @action({
    id: 'repo.import',
    cli: ['repo', 'import'],
    http: ['POST', '/api/repos/import'],
    summary: '导入仓库布局（--strategy ours|overwrite|duplicate；--select 按 key 挑；--clone 选克隆范围）',
    args: ['file'],
    input: repoImportInput,
    render: (d: any) => transfer.renderResult(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { json, docsFiles } = await readLayout(ctx);
        return transfer.repoImport({
          json,
          docsFiles,
          selection: ctx.select,
          boardSelection: ctx.boards,
          strategy: ctx.strategy || 'ours',
          clone: ctx.clone || 'none',
        });
    
  }
}
