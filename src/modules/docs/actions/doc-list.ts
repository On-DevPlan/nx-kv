// doc.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listDocs as _listDocs } from '../service.js';
import { renderList as _renderList } from '../render.js';
const listDocs: any = _listDocs;
const renderList: any = _renderList;

/** doc.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  external: z.boolean().optional().describe("附带外部绑定闭包内的文档与绑定清单"),
});

export class DocListAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.list',
    cli: ['docs', 'list'],
    http: ['GET', '/api/docs'],
    summary: '文档树索引（自有 + 可选外部；零副作用，双链解析的数据源）',
    input,
    render: renderList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return listDocs(ctx);
  
  }
}
