// repo.remote.pick —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRemotePickInput } from '../schemas.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

export class RepoRemotePickAction extends ActionBase<typeof repoRemotePickInput> {
  @action({
    id: 'repo.remote.pick',
    cli: ['repo', 'remote', 'pick'],
    http: ['POST', '/api/repos/remote/pick'],
    summary: '人工指定采纳哪条 remote（key 随之重算；自定义 key 不动）',
    args: ['id', 'url'],
    input: repoRemotePickInput,
    render: (d: any) => `已对齐 remote: ${d.key} → ${d.remote}${d.keyCustom ? '（自定义 key 不变）' : ''}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.pickRemote(ctx.id, ctx.url);
  
  }
}
