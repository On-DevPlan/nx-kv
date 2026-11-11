// repo.ref.clone —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refNs from '../ref.js';
import { renderClone as _renderClone } from '../cli/render.js';
const ref: any = refNs;
const renderClone: any = _renderClone;

/** repo.ref.clone 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  url: z.string(),
  name: z.string().optional().describe("名称（缺省取 URL 末段）"),
  desc: z.string().optional().describe("一句话描述（它参考什么）"),
  notes: z.string().optional(),
  board: z.array(z.string()).optional().describe("顺手挂到看板（id 可多个，逗号分隔）"),
  bind: z.array(z.string()).optional().describe("绑定的开发仓库（id/路径/名称，可多个，逗号分隔）"),
  depth: z.number().default(1).describe("浅克隆深度（默认 1）"),
  'no-bind': z.boolean().optional().describe("关闭自动绑定（默认绑当前目录命中的开发仓库）"),
});

export class RepoRefCloneAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.clone',
    cli: ['repo', 'ref', 'clone'],
    http: ['POST', '/api/repos/ref/clone'],
    summary: '克隆远程仓库为参考仓库（落到 gitRepoRoot，登记 + 可选绑定当前目录的开发仓库）',
    args: ['url'],
    input,
    render: renderClone,
  })
  override async run(ctx: ActionInput<this['_input']>) {

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
