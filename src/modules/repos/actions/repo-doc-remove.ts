// repo.doc.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { removeRepoDoc as _removeRepoDoc } from '../../docs/refs.js';
const removeRepoDoc: any = _removeRepoDoc;

/** repo.doc.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  index: z.number().describe("序号（1 = 主篇）"),
});

export class RepoDocRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.doc.remove',
    cli: ['repo', 'doc', 'remove'],
    http: ['DELETE', '/api/repos/docs'],
    summary: '从项目的介绍文档集里摘掉一篇（--index 从 1 起，1 = 主篇）',
    args: ['id'],
    input,
    render: () => `已摘掉一篇介绍文档`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return removeRepoDoc(ctx.id, ctx.index);
  
  }
}
