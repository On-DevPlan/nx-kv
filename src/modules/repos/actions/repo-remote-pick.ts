// repo.remote.pick —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

/** repo.remote.pick 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  url: z.string(),
});

export class RepoRemotePickAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.remote.pick',
    cli: ['repo', 'remote', 'pick'],
    http: ['POST', '/api/repos/remote/pick'],
    summary: '人工指定采纳哪条 remote（key 随之重算；自定义 key 不动）',
    args: ['id', 'url'],
    input,
    render: (d: any) => `已对齐 remote: ${d.key} → ${d.remote}${d.keyCustom ? '（自定义 key 不变）' : ''}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.pickRemote(ctx.id, ctx.url);
  
  }
}
