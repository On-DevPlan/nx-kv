// file.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { fileListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileListAction extends ActionBase {
  @action({
    id: 'file.list',
    cli: ['file', 'list'],
    http: ['GET', '/api/file'],
    summary: '列出当前用户空间的附件（含本地已同步路径）',
    input: fileListInput,
    render: (d: any) => service.renderFileList(d),
  })
  async list(ctx: any) {

      return service.listFilesAction(ctx);
  
  }
}
