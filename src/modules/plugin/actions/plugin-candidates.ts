// plugin.candidates —— 候选条目标准接口（面板列表 / 未来正文搜索与引用）。
//
// 只返回插件声明的纯数据：id / label / description / kind / path / text / meta。
// 宿主不认识具体业务，过滤与截断在 candidates.ts。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listCandidates } from '../candidates.js';

const input = z.object({
  pluginId: z.string().optional().describe('只列某个插件（缺省 = 全部已启用插件）'),
  q: z.string().optional().describe('关键字（label / description / path / text）'),
  limit: z.number().optional().describe('返回上限（默认 200，最大 1000）'),
  topic: z.string().optional().describe('主题 key（插件上下文）'),
  group: z.string().optional().describe('组 key'),
  repo: z.string().optional().describe('仓库 key'),
  cwd: z.string().optional().describe('工作目录（无 topic 时插件按它定位）'),
});

export class PluginCandidatesAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.candidates',
    cli: ['plugin', 'candidates'],
    http: ['GET', '/api/plugins/candidates'],
    summary: '插件候选条目标准接口（面板列表 / 正文搜索与引用；按插件启用状态聚合）',
    input,
    render: (d: any) => {
      const rows = Array.isArray(d?.candidates) ? d.candidates : [];
      const lines = [`候选条目 ${rows.length} 个`];
      for (const c of rows) {
        lines.push(`  · [${c.pluginId}] ${c.label}  ${c.kind || ''}  ${c.path || c.id}`);
      }
      for (const w of d?.warnings || []) lines.push(`  ! ${w}`);
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return listCandidates({
      pluginId: ctx.pluginId,
      q: ctx.q,
      limit: ctx.limit,
      topicKey: ctx.topic,
      groupKey: ctx.group,
      repoKey: ctx.repo,
      cwd: ctx.cwd,
    });
  }
}
