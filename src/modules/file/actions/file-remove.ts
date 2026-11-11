// file.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  fileId: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class FileRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'file.remove',
    cli: ['file', 'remove'],
    http: ['DELETE', '/api/file/item'],
    summary: '删除附件（后端软删；本地副本要清用 file sync --prune）',
    args: ['fileId'],
    input,
    render: (d: any) => service.renderRemove(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeFileAction(ctx.fileId, { group: ctx.group });
  
  }
}
