// file.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileRemoveAction extends ActionBase<typeof fileRemoveInput> {
  @action({
    id: 'file.remove',
    cli: ['file', 'remove'],
    http: ['DELETE', '/api/file/item'],
    summary: '删除附件（后端软删；本地副本要清用 file sync --prune）',
    args: ['fileId'],
    input: fileRemoveInput,
    render: (d: any) => service.renderRemove(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeFileAction(ctx.fileId, { group: ctx.group });
  
  }
}
