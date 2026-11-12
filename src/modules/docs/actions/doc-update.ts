// doc.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import { updateDoc as _updateDoc } from '../service.js';
import { renderWritten as _renderWritten } from '../render.js';
const updateDoc: any = _updateDoc;
const renderWritten: any = _renderWritten;

/** doc.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
  body: z.string().optional().describe("Markdown 全文"),
  desc: z.string().optional().describe("短描述（列表 / 提示词模板的快速定位标签；只给 desc 时不动正文）"),
  bodyFile: z.string().optional().describe("从文件读全文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
});

export class DocUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.update',
    cli: ['docs', 'set'],
    http: ['PATCH', '/api/docs/item'],
    summary: '写文档正文 / 描述（面板保存走这里；ref 是 DB 实体，--ref 可给 refId；只给 --desc 时不动正文）',
    args: ['ref'],
    input,
    render: renderWritten,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return updateDoc(
            { ref: ctx.ref, body: ctx.body, desc: ctx.desc, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
            opts
          );
  
  }
}
