// repo.detect —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoDetectInput } from '../schemas.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

export class RepoDetectAction extends ActionBase<typeof repoDetectInput> {
  @action({
    id: 'repo.detect',
    cli: ['repo', 'detect'],
    http: ['POST', '/api/repos/detect'],
    summary: '探测目录的 git remote（添加仓库前自动填充远程地址；只读）',
    args: ['path'],
    input: repoDetectInput,
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
