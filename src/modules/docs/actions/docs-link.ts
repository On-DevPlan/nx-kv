// docs.link —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docsLinkInput } from '../schemas.js';
import * as refsNs from '../refs.js';
import { renderLink as _renderLink } from '../render.js';
const refs: any = refsNs;
const renderLink: any = _renderLink;

export class DocsLinkAction extends ActionBase<typeof docsLinkInput> {
  @action({
    id: 'docs.link',
    cli: ['docs', 'link'],
    http: ['POST', '/api/docs/link'],
    summary: '维护组的附加文档列表（--doc <自有路径|绝对路径> + --note/--tag；--remove <序号> 移除；--before <序号> 插位；同 doc 重复添加 = 更新）',
    args: ['board'],
    input: docsLinkInput,
    render: renderLink,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refs.setDocLink(ctx);
  
  }
}
