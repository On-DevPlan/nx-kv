// repo.ref.of —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refNs from '../ref.js';
import { renderRefsOf as _renderRefsOf } from '../cli/render.js';
const ref: any = refNs;
const renderRefsOf: any = _renderRefsOf;

/** repo.ref.of 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string().optional(),
});

export class RepoRefOfAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.of',
    cli: ['repo', 'ref', 'of'],
    http: ['GET', '/api/repos/ref/of'],
    summary: '查某仓库（缺省当前目录）的参考仓库：直接绑定到本仓库的 + 所属组绑定的，两类并列',
    args: ['id'],
    input,
    render: renderRefsOf,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return ref.refReposOfRepo(ctx.id || process.cwd());
  
  }
}
