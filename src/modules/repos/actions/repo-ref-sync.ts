// repo.ref.sync —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRefSyncInput } from '../schemas.js';
import * as refNs from '../ref.js';
import { renderRefSync as _renderRefSync } from '../cli/render.js';
const ref: any = refNs;
const renderRefSync: any = _renderRefSync;

export class RepoRefSyncAction extends ActionBase<typeof repoRefSyncInput> {
  @action({
    id: 'repo.ref.sync',
    cli: ['repo', 'ref', 'sync'],
    http: ['POST', '/api/repos/ref/sync'],
    summary: '同步参考仓库（git pull --ff-only；--all 同步全部）',
    args: ['id'],
    input: repoRefSyncInput,
    render: (d: any) => (d.results ? renderRefSync(d) : `已同步: ${d.name}（${d.status}${d.output ? ' — ' + d.output.split('\n')[0] : ''}）`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return (ctx.all ? ref.syncAllRefs() : ref.syncRef(ctx.id));
  
  }
}
