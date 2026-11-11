// file.sync —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.sync 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ids: z.array(z.string()).optional().describe("只同步这些 fileId（逗号分隔）"),
  dir: z.string().optional().describe("本地目录（默认 ~/.nx-kv/attachments/<工作空间>/）"),
  prune: z.boolean().optional().describe("删掉本地已不在后端的文件（仅全量同步时生效）"),
  dryRun: z.boolean().optional().describe("只列出将下载什么，不落盘"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class FileSyncAction extends ActionBase<typeof input> {
  @action({
    id: 'file.sync',
    cli: ['file', 'sync'],
    http: ['POST', '/api/file/sync'],
    summary: '把附件同步到本机（默认全部；--ids 只同步指定附件）——为了不再依赖网络读附件',
    input,
    render: (d: any) => service.renderSync(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.syncFilesAction(ctx);
  
  }
}
