// doc.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { docUpdateInput } from '../schemas.js';
import { updateDoc as _updateDoc } from '../service.js';
import { renderWritten as _renderWritten } from '../render.js';
const updateDoc: any = _updateDoc;
const renderWritten: any = _renderWritten;

export class DocUpdateAction extends ActionBase<typeof docUpdateInput> {
  @action({
    id: 'doc.update',
    cli: ['docs', 'set'],
    http: ['PATCH', '/api/docs/item'],
    summary: '写文档正文（面板保存走这里；自有走 own 树、外部走绑定闭包内原文件；写盘后摘要回写 desc / 组内 note）',
    args: ['ref'],
    input: docUpdateInput,
    render: renderWritten,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return updateDoc(
            { ref: ctx.ref, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
            opts
          );
  
  }
}
