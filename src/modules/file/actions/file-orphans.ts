// file.orphans —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileOrphansInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileOrphansAction extends ActionBase<typeof fileOrphansInput> {
  @action({
    id: 'file.orphans',
    cli: ['file', 'orphans'],
    http: ['GET', '/api/file/orphans'],
    summary: '列出无主资源（没有任何任务/文档关系边；删任务、删文档、删正文行之后用）',
    input: fileOrphansInput,
    render: (d: any) => service.renderOrphans(d),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listOrphanAttachmentsAction();
  
  }
}
