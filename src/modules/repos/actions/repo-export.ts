// repo.export —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoExportInput } from '../schemas.js';
import * as transferNs from '../transfer.js';
const transfer: any = transferNs;

export class RepoExportAction extends ActionBase<typeof repoExportInput> {
  @action({
    id: 'repo.export',
    cli: ['repo', 'export'],
    http: ['GET', '/api/repos/export'],
    summary: '导出仓库布局 JSON（全局 key + 分组 + 参考关系；不含本地路径）；--zip 打包成 zip',
    input: repoExportInput,
    render: (d: any) => (d && d.file
      ? `已导出 zip: ${d.file}（${d.bytes} 字节）\n包含 layout.json + README.txt + docs/（自有文档树），可回灌 repo import`
      : JSON.stringify(d, null, 2)),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const opts: any = {
          repoKeys: ctx.repos,
          boardKeys: ctx.boards,
          includeUnassigned: ctx['no-unassigned'] !== true,
        };
        if (ctx.zip) return transfer.writeExportZip(ctx.zip, opts);
        return transfer.repoExport(opts);
    
  }
}
