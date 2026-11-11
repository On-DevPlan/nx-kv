// repo.export —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as transferNs from '../transfer.js';
const transfer: any = transferNs;

/** repo.export 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  zip: z.string().optional().describe("打包成 zip 写到这个路径（含 layout.json + README）"),
  repos: z.array(z.string()).optional().describe("只导出这些仓库 key（逗号分隔；空 = 全部）"),
  boards: z.array(z.string()).optional().describe("只导出这些看板 key（逗号分隔；空 = 全部）"),
  'no-unassigned': z.boolean().optional().describe("不带未分组的仓库"),
});

export class RepoExportAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.export',
    cli: ['repo', 'export'],
    http: ['GET', '/api/repos/export'],
    summary: '导出仓库布局 JSON（全局 key + 分组 + 参考关系；不含本地路径）；--zip 打包成 zip',
    input,
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
