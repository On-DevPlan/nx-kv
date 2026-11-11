// docs.index —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as linksNs from '../links.js';
const links: any = linksNs;

/** docs.index 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class DocsIndexAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.index',
    cli: ['docs', 'index'],
    http: ['GET', '/api/docs/index'],
    summary: '双链索引（docId + 文件名；前端点击 [[..]] 前拉一次；解析规则见 core/wikilink.js）',
    input,
    render: (d: any) => d.index.map((x: any) => `  ${x.name}  →  ${x.docId}`).join('\n') || '（空）',
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return ({ index: await links.buildIndex() });
  
  }
}
