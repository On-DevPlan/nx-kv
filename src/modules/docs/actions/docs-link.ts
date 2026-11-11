// docs.link —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refsNs from '../refs.js';
import { renderLink as _renderLink } from '../render.js';
const refs: any = refsNs;
const renderLink: any = _renderLink;

/** docs.link 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  board: z.string(),
  doc: z.string().optional().describe("自有树路径 = 自有文档；盘符/绝对路径 = 外部只读引用"),
  note: z.string().optional().describe("条目说明"),
  tag: z.string().optional().describe("分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）"),
  remove: z.number().optional().describe("移除第 N 条（1 起）"),
  before: z.number().optional().describe("插到第 N 条之前（缺省追加到末尾）"),
});

export class DocsLinkAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.link',
    cli: ['docs', 'link'],
    http: ['POST', '/api/docs/link'],
    summary: '维护组的附加文档列表（--doc <自有路径|绝对路径> + --note/--tag；--remove <序号> 移除；--before <序号> 插位；同 doc 重复添加 = 更新）',
    args: ['board'],
    input,
    render: renderLink,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refs.setDocLink(ctx);
  
  }
}
