// repo.remote.check —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRemoteCheckInput } from '../schemas.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

export class RepoRemoteCheckAction extends ActionBase<typeof repoRemoteCheckInput> {
  @action({
    id: 'repo.remote.check',
    cli: ['repo', 'remote', 'check'],
    http: ['GET', '/api/repos/remote/check'],
    summary: '检查 remote 是否存在（git ls-remote：存在 / 不存在 / 不可达，三种结论分清）',
    args: ['id'],
    input: repoRemoteCheckInput,
    render: (d: any) => {
      const mark: any = ({ exists: '✓ 存在', missing: '✗ 不存在', unreachable: '? 不可达' } as any)[d.status] || d.status;
      return `${mark}  ${d.url} —— ${d.detail}`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.checkRemote(ctx.id, ctx.url);
  
  }
}
