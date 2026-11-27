// plugin.tree —— 给插件页读项目目录（只允许已登记 repo，路径限制在 repo 根内）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listRepoTree } from '../fs.js';

const input = z.object({
  repoKey: z.string().describe('仓库 key'),
  path: z.string().optional().describe('仓库内相对目录；空 = 根'),
  showHidden: z.boolean().optional().describe('是否显示隐藏文件/目录'),
});

export class PluginTreeAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.tree',
    cli: ['plugin', 'tree'],
    http: ['GET', '/api/plugins/tree'],
    summary: '列出已登记仓库的目录（插件页用）',
    input,
    render: (d: any) => {
      const entries = Array.isArray(d?.entries) ? d.entries : [];
      return [
        `${d?.repoName || d?.repoKey || ''}/${d?.path || ''}  ${entries.length} 项${d?.truncated ? '（截断）' : ''}`,
        ...entries.map((e: any) => `${e.type === 'dir' ? '[D]' : '[F]'} ${e.path}`),
      ].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return listRepoTree(ctx);
  }
}
