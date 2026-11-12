// file.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  fileId: z.string(),
});

export class FileGetAction extends ActionBase<typeof input> {
  @action({
    id: 'file.get',
    cli: ['file', 'get'],
    http: ['GET', '/api/file/item'],
    summary: '查单个附件的元数据与本机路径',
    args: ['fileId'],
    input,
    render: (d: any) => service.renderFileInfo(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getFileAction(ctx.fileId);
  
  }
}
