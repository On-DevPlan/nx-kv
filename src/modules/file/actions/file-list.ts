// file.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
  limit: z.number().default(100),
  offset: z.number().default(0),
});

export class FileListAction extends ActionBase<typeof input> {
  @action({
    id: 'file.list',
    cli: ['file', 'list'],
    http: ['GET', '/api/file'],
    summary: '列出当前用户空间的附件（含本地已同步路径）',
    input,
    render: (d: any) => service.renderFileList(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listFilesAction(ctx);
  
  }
}
