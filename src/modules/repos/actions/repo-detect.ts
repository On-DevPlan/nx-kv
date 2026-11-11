// repo.detect —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

/** repo.detect 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  path: z.string(),
});

export class RepoDetectAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.detect',
    cli: ['repo', 'detect'],
    http: ['POST', '/api/repos/detect'],
    summary: '探测目录的 git remote（添加仓库前自动填充远程地址；只读）',
    args: ['path'],
    input,
    render: (d: any) => {
      if (!d.exists) return `目录不存在: ${d.path}`;
      if (!d.isGit) return `不是 git 仓库: ${d.path}`;
      if (!d.recommended) return `git 仓库没有配置 remote: ${d.path}`;
      return [
        `远程地址: ${d.recommended}（key: ${d.key}）`,
        ...d.remotes.filter((x: any) => x.url !== d.recommended).map((x: any) => `  其它候选: ${x.name} ${x.url} [${x.kind}]`),
      ].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.detectRemote(ctx.path);
  
  }
}
