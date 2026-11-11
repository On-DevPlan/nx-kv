// file.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileGetAction extends ActionBase<typeof fileGetInput> {
  @action({
    id: 'file.get',
    cli: ['file', 'get'],
    http: ['GET', '/api/file/item'],
    summary: '查单个附件的元数据与本地路径',
    args: ['fileId'],
    input: fileGetInput,
    render: (d: any) => service.renderFileInfo(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getFileAction(ctx.fileId, { group: ctx.group });
  
  }
}
