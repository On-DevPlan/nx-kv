// plugin.context —— 给插件页的完整 topic 上下文（topic/repo/group/组内 repo 列表）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { pluginContextView } from '../context.js';

const input = z.object({
  topicKey: z.string().optional().describe('主题 key（优先）'),
  groupKey: z.string().optional().describe('组 key（无 topic 时）'),
  repoKey: z.string().optional().describe('仓库 key（无 topic 时）'),
  cwd: z.string().optional().describe('工作目录（定位兜底）'),
});

export class PluginContextAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.context',
    cli: ['plugin', 'context'],
    http: ['GET', '/api/plugins/context'],
    summary: '取当前 topic 的完整上下文（插件缺东西时自行请求）',
    input,
    render: (d: any) => {
      const t = d?.topic || {};
      const repos = Array.isArray(d?.repos) ? d.repos : [];
      return [
        `topic: ${t.key || '-'}  ${t.name || ''}  kind=${t.kind || 'unknown'}`,
        `cwd: ${t.cwd || '-'}`,
        `repo: ${t.repoKey || '-'}  ${t.repoName || ''}  root=${t.repoRoot || '-'}`,
        `group: ${t.groupKey || '-'}  ${t.groupName || ''}`,
        `repos(${repos.length}): ${repos.map((r: any) => r.key).join(', ') || '-'}`,
      ].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return pluginContextView({
      topicKey: ctx.topicKey,
      groupKey: ctx.groupKey,
      repoKey: ctx.repoKey,
      cwd: ctx.cwd,
    });
  }
}
