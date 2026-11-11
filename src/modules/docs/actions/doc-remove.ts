// doc.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { docRemoveInput } from '../schemas.js';
import { removeDoc as _removeDoc } from '../service.js';
const removeDoc: any = _removeDoc;

export class DocRemoveAction extends ActionBase {
  @action({
    id: 'doc.remove',
    cli: ['docs', 'remove'],
    http: ['DELETE', '/api/docs/item'],
    summary: '删除自有文档（外部绑定不可删）',
    args: ['ref'],
    input: docRemoveInput,
    render: (d: any) => `已删除: ${d.rel}`,
  })
  async remove(ctx: any) {

      return removeDoc(ctx);
  
  }
}
