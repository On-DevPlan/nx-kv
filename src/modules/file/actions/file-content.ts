// file.content —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { fileContentInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileContentAction extends ActionBase {
  @action({
    id: 'file.content',
    cli: ['file', 'content'],
    http: ['GET', '/api/file/content/:fileId'],
    summary: '取附件本体：面板内联预览；CLI 打印出图地址与本地路径',
    args: ['fileId'],
    input: fileContentInput,
    render: (d: any) => service.renderContent(d),
    stream: true,
  })
  async content(ctx: any) {

      return (ctx.__raw
          ? service.serveContent(ctx)
          : service.getFileAction(ctx.fileId, { group: ctx.group }));
  
  }
}
