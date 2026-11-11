// repo.ref.clone —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRefCloneInput } from '../schemas.js';
import * as refNs from '../ref.js';
import { renderClone as _renderClone } from '../cli/render.js';
const ref: any = refNs;
const renderClone: any = _renderClone;

export class RepoRefCloneAction extends ActionBase {
  @action({
    id: 'repo.ref.clone',
    cli: ['repo', 'ref', 'clone'],
    http: ['POST', '/api/repos/ref/clone'],
    summary: '克隆远程仓库为参考仓库（落到 gitRepoRoot，登记 + 可选绑定当前目录的开发仓库）',
    args: ['url'],
    input: repoRefCloneInput,
    render: renderClone,
  })
  async clone(ctx: any) {

      return ref.cloneRef({
          url: ctx.url,
          name: ctx.name,
          desc: ctx.desc,
          notes: ctx.notes,
          board: ctx.board,
          bind: ctx.bind,
          depth: ctx.depth,
          noBind: ctx['no-bind'] === true,
        });
  
  }
}
