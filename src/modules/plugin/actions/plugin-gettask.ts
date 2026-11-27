// plugin.gettask —— gettask 声明聚合（任务编辑页 dock tab / CLI 巡检）。
//
// 只返回「插件声明了什么」：段 id / 标签 / 出厂模板 / 变量目录 / UI 挂载点。
// 具体任务的数据由插件 client 端通过 plugin.rpc 自取，交付区块由 claim 取。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listGetTaskEntries } from '../gettask.js';

const input = z.object({
  topic: z.string().optional().describe('主题 key（topic:<key> 可见性）'),
  group: z.string().optional().describe('组 key'),
  repo: z.string().optional().describe('仓库 key'),
  taskId: z.string().optional().describe('任务号或草稿键（仅回显；声明与任务无关）'),
});

export class PluginGetTaskAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.gettask',
    cli: ['plugin', 'gettask'],
    http: ['GET', '/api/plugins/gettask'],
    summary: '列出插件注册的 gettask 区块（任务编辑页 dock tab + 领取交付时的插件区块）',
    input,
    render: (d: any) => {
      const rows = Array.isArray(d?.entries) ? d.entries : [];
      const lines = [`gettask 区块 ${rows.length} 个`];
      for (const e of rows) {
        lines.push(
          `  · [${e.pluginId}] ${e.label}  ${e.segment}` +
            `  <${e.tag}>` +
            (e.ui ? `  UI ${e.ui.panel}` : ''),
        );
      }
      for (const w of d?.warnings || []) lines.push(`  ! ${w}`);
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const r = await listGetTaskEntries({
      topicKey: ctx.topic,
      groupKey: ctx.group,
      repoKey: ctx.repo,
    });
    return { ...r, taskId: ctx.taskId || null };
  }
}
