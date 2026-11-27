import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const input = z.object({
  topic: z.string().optional().describe('主题 key（topic:<key> 可见性）'),
  group: z.string().optional().describe('组 key（无 topic 时用 group:<key>）'),
  repo: z.string().optional().describe('仓库 key（无 topic 时用 repo:<key>）'),
  all: z.boolean().optional().describe('true = 含被本 scope 隐藏的入口（管理页用）'),
});

export class PluginEntriesAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.entries',
    cli: ['plugin', 'entries'],
    http: ['GET', '/api/pretask/entries'],
    summary: '列出当前主题可见的 pretask 入口（按插件分组；all=true 含隐藏项）',
    input,
    render: (d: any) => {
      const rows = Array.isArray(d?.entries) ? d.entries : [];
      const lines = [`入口 ${rows.length} 个（默认 ${d?.defaultEntryId || '无'}）`];
      for (const e of rows) {
        lines.push(
          `  ${e.visible === false ? '×' : '·'} [${e.pluginId}] ${e.label}  (${e.kind})` +
            (e.id === d?.defaultEntryId ? '  ★默认' : '') +
            (e.builtin ? '  [内置]' : ''),
        );
      }
      for (const w of d?.warnings || []) lines.push(`  ! ${w}`);
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.listEntries({
      topicKey: ctx.topic,
      groupKey: ctx.group,
      repoKey: ctx.repo,
      all: ctx.all,
    });
  }
}
