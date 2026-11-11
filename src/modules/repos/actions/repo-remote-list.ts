// repo.remote.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRemoteListInput } from '../schemas.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

export class RepoRemoteListAction extends ActionBase {
  @action({
    id: 'repo.remote.list',
    cli: ['repo', 'remote', 'list'],
    http: ['GET', '/api/repos/remote/list'],
    summary: '列出仓库的全部 remote 候选（git remote -v），标出当前采纳的那条',
    args: ['id'],
    input: repoRemoteListInput,
    render: (d: any) => {
      const lines: any = [`「${d.name}」的 remote（当前采纳: ${d.current || '（无）'}）`];
      for (const r of d.remotes) {
        lines.push(`  ${r.current ? '●' : '○'} ${r.name.padEnd(10)} ${r.url}  [${r.kind}] → key ${r.derivedKey}`);
      }
      if (!d.remotes.length) lines.push('  （没有 remote —— 先 git remote add）');
      return lines.join('\n');
    },
  })
  async list(ctx: any) {

      return remote.listRemotes(ctx.id);
  
  }
}
