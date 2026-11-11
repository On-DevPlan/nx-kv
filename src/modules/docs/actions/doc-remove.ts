// doc.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { removeDoc as _removeDoc } from '../service.js';
const removeDoc: any = _removeDoc;

/** doc.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string(),
});

export class DocRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.remove',
    cli: ['docs', 'remove'],
    http: ['DELETE', '/api/docs/item'],
    summary: '删除自有文档（外部绑定不可删）',
    args: ['ref'],
    input,
    render: (d: any) => `已删除: ${d.rel}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return removeDoc(ctx);
  
  }
}
