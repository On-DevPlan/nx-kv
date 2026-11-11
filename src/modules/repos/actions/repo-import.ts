// repo.import —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as transferNs from '../transfer.js';
import { readLayout as _readLayout } from '../cli/render.js';
const transfer: any = transferNs;
const readLayout: any = _readLayout;

/** repo.import 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  file: z.string().optional(),
  json: z.string().optional().describe("（面板）直接给布局 JSON"),
  strategy: z.enum(["ours", "overwrite", "duplicate"]).default('ours').describe("冲突方案：保留本地 / 覆盖 / 另存 key-import-N"),
  select: z.array(z.string()).optional().describe("只处理这些仓库 key（逗号分隔；空 = 全部）"),
  boards: z.array(z.string()).optional().describe("只处理这些看板 key（逗号分隔；空 = 全部）"),
  clone: z.enum(["all", "dev", "ref", "none"]).optional().describe("要克隆哪些（默认 none = 只登记）"),
});

export class RepoImportAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.import',
    cli: ['repo', 'import'],
    http: ['POST', '/api/repos/import'],
    summary: '导入仓库布局（--strategy ours|overwrite|duplicate；--select 按 key 挑；--clone 选克隆范围）',
    args: ['file'],
    input,
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
