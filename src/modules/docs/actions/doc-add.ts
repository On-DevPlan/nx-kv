// doc.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { addDoc as _addDoc } from '../service.js';
import { renderWritten as _renderWritten } from '../render.js';
const addDoc: any = _addDoc;
const renderWritten: any = _renderWritten;

/** doc.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  rel: z.string(),
  body: z.string().optional().describe("Markdown 正文"),
  bodyFile: z.string().optional().describe("从文件读正文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
});

export class DocAddAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.add',
    cli: ['docs', 'add'],
    http: ['POST', '/api/docs/item'],
    summary: '新建自有文档（--body 给 Markdown 正文；--body-file <文件> / - 读管道；已存在则报冲突）',
    args: ['rel'],
    input,
    render: renderWritten,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return addDoc(
            { rel: ctx.rel, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
            opts
          );
  
  }
}
