// repo.ref.of —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRefOfInput } from '../schemas.js';
import * as refNs from '../ref.js';
import { renderRefsOf as _renderRefsOf } from '../cli/render.js';
const ref: any = refNs;
const renderRefsOf: any = _renderRefsOf;

export class RepoRefOfAction extends ActionBase {
  @action({
    id: 'repo.ref.of',
    cli: ['repo', 'ref', 'of'],
    http: ['GET', '/api/repos/ref/of'],
    summary: '查某仓库（缺省当前目录）的参考仓库：直接绑定到本仓库的 + 所属组绑定的，两类并列',
    args: ['id'],
    input: repoRefOfInput,
    render: renderRefsOf,
  })
  async of(ctx: any) {

      return ref.refReposOfRepo(ctx.id || process.cwd());
  
  }
}
