// file.orphans —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.orphans 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class FileOrphansAction extends ActionBase<typeof input> {
  @action({
    id: 'file.orphans',
    cli: ['file', 'orphans'],
    http: ['GET', '/api/file/orphans'],
    summary: '列出无主资源（没有任何任务/文档关系边；删任务、删文档、删正文行之后用）',
    input,
    render: (d: any) => service.renderOrphans(d),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listOrphanAttachmentsAction();
  
  }
}
