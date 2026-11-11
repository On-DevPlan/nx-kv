// docs.index —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { docsIndexInput } from '../schemas.js';
import * as linksNs from '../links.js';
const links: any = linksNs;

export class DocsIndexAction extends ActionBase {
  @action({
    id: 'docs.index',
    cli: ['docs', 'index'],
    http: ['GET', '/api/docs/index'],
    summary: '双链索引（docId + 文件名；前端点击 [[..]] 前拉一次；解析规则见 core/wikilink.js）',
    input: docsIndexInput,
    render: (d: any) => d.index.map((x: any) => `  ${x.name}  →  ${x.docId}`).join('\n') || '（空）',
  })
  async index(_ctx: any) {

      return ({ index: await links.buildIndex() });
  
  }
}
