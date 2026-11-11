// doc.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docGetInput } from '../schemas.js';
import { getDoc as _getDoc } from '../service.js';
import { renderGet as _renderGet } from '../render.js';
const getDoc: any = _getDoc;
const renderGet: any = _renderGet;

export class DocGetAction extends ActionBase<typeof docGetInput> {
  @action({
    id: 'doc.get',
    cli: ['docs', 'get'],
    http: ['GET', '/api/docs/item'],
    summary: '读文档全文：rel:<路径>（或裸相对路径）= 自有；path:<绝对路径> = 外部（须在绑定闭包内）；约定路径缺失时惰性播种',
    args: ['ref'],
    input: docGetInput,
    render: renderGet,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return getDoc(ctx);
  
  }
}
