// file.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.prune 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  'dry-run': z.boolean().optional().describe("只列清单不删除"),
  dryRun: z.boolean().optional().describe("同 --dry-run（HTTP body 用）"),
});

export class FilePruneAction extends ActionBase<typeof input> {
  @action({
    id: 'file.prune',
    cli: ['file', 'prune'],
    http: ['POST', '/api/file/prune'],
    summary: '回收无主资源（DB 行 + 附件根目录内的本机/镜像字节；仍被引用的不删）',
    input,
    render: (d: any) => service.renderPrune(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.pruneOrphanAttachmentsAction({ dryRun: (ctx.dryRun ?? ctx['dry-run']) === true });
  
  }
}
