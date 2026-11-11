// repo.remote.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

/** repo.remote.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string().optional(),
});

export class RepoRemoteListAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.remote.list',
    cli: ['repo', 'remote', 'list'],
    http: ['GET', '/api/repos/remote/list'],
    summary: '列出仓库的全部 remote 候选（git remote -v），标出当前采纳的那条',
    args: ['id'],
    input,
    render: (d: any) => {
      const lines: any = [`「${d.name}」的 remote（当前采纳: ${d.current || '（无）'}）`];
      for (const r of d.remotes) {
        lines.push(`  ${r.current ? '●' : '○'} ${r.name.padEnd(10)} ${r.url}  [${r.kind}] → key ${r.derivedKey}`);
      }
      if (!d.remotes.length) lines.push('  （没有 remote —— 先 git remote add）');
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.listRemotes(ctx.id);
  
  }
}
