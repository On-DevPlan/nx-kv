// repo.ref.sync —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refNs from '../ref.js';
import { renderRefSync as _renderRefSync } from '../cli/render.js';
const ref: any = refNs;
const renderRefSync: any = _renderRefSync;

/** repo.ref.sync 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string().optional(),
  all: z.boolean().optional().describe("同步全部参考仓库"),
});

export class RepoRefSyncAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.sync',
    cli: ['repo', 'ref', 'sync'],
    http: ['POST', '/api/repos/ref/sync'],
    summary: '同步参考仓库（git pull --ff-only；--all 同步全部）',
    args: ['id'],
    input,
    render: (d: any) => (d.results ? renderRefSync(d) : `已同步: ${d.name}（${d.status}${d.output ? ' — ' + d.output.split('\n')[0] : ''}）`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return (ctx.all ? ref.syncAllRefs() : ref.syncRef(ctx.id));
  
  }
}
