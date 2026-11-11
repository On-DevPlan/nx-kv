// doc.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { docAddInput } from '../schemas.js';
import { addDoc as _addDoc } from '../service.js';
import { renderWritten as _renderWritten } from '../render.js';
const addDoc: any = _addDoc;
const renderWritten: any = _renderWritten;

export class DocAddAction extends ActionBase<typeof docAddInput> {
  @action({
    id: 'doc.add',
    cli: ['docs', 'add'],
    http: ['POST', '/api/docs/item'],
    summary: '新建自有文档（--body 给 Markdown 正文；--body-file <文件> / - 读管道；已存在则报冲突）',
    args: ['rel'],
    input: docAddInput,
    render: renderWritten,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return addDoc(
            { rel: ctx.rel, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
            opts
          );
  
  }
}
