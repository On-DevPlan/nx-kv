// file.upload —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.upload 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  path: z.string().optional().describe("本机文件路径"),
  content: z.string().optional().describe("base64 内容（面板上传用，可为 data URL）"),
  name: z.string().optional().describe("文件名（content 上传时必填）"),
  contentType: z.string().optional().describe("覆盖 Content-Type（默认按扩展名猜）"),
});

export class FileUploadAction extends ActionBase<typeof input> {
  @action({
    id: 'file.upload',
    cli: ['file', 'upload'],
    http: ['POST', '/api/file'],
    summary: '上传附件到本机附件仓（不碰网；本地任务/文档贴图用）',
    input,
    render: (d: any) => service.renderUpload(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.uploadFileAction(ctx);
  
  }
}
