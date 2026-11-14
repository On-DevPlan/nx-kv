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
  board: z.string().optional().describe('查这个组（id / key / 名称）绑定的参考仓库（含绑定描述）——右侧栏组视图用'),
});

export class RepoRefOfAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.of',
    cli: ['repo', 'ref', 'of'],
    http: ['GET', '/api/repos/ref/of'],
    summary: '查参考仓库：--id 某仓库（缺省当前目录）看它直接绑的 + 所属组绑的，两类并列；--board 某组 看这个组绑定的（带绑定描述）',
    args: ['id'],
    input,
    render: renderRefsOf,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      // #132：组视图也要能问「这个组绑了哪些参考仓库、说明写的什么」——
      // 右侧栏文档列表要就地编辑绑定描述，就靠这条。
      if (ctx.board) return ref.refReposOfBoard(ctx.board);
      return ref.refReposOfRepo(ctx.id || process.cwd());
  
  }
}
