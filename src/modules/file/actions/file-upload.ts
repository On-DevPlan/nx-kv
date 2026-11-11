// file.upload —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileUploadInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileUploadAction extends ActionBase<typeof fileUploadInput> {
  @action({
    id: 'file.upload',
    cli: ['file', 'upload'],
    http: ['POST', '/api/file'],
    summary: '上传附件（--local 存本机附件仓，本地任务贴图用；默认传当前用户空间的云端图床）',
    input: fileUploadInput,
    render: (d: any) => service.renderUpload(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.uploadFileAction(ctx);
  
  }
}
