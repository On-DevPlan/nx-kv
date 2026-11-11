// file.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { filePruneInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FilePruneAction extends ActionBase {
  @action({
    id: 'file.prune',
    cli: ['file', 'prune'],
    http: ['POST', '/api/file/prune'],
    summary: '回收无主资源（DB 行 + 附件根目录内的本机/镜像字节；仍被引用的不删）',
    input: filePruneInput,
    render: (d: any) => service.renderPrune(d),
  })
  async prune(ctx: any) {

      return service.pruneOrphanAttachmentsAction({ dryRun: (ctx.dryRun ?? ctx['dry-run']) === true });
  
  }
}
