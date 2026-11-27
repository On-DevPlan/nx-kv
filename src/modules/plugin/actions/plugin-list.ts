import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const input = z.object({});

export class PluginListAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.list',
    cli: ['plugin', 'list'],
    http: ['GET', '/api/plugins'],
    summary: '列出内部插件（全局开关、入口数、client/style URL、加载错误）',
    input,
    render: (d: any) => {
      const rows = Array.isArray(d) ? d : [];
      const lines = [`插件 ${rows.length} 个`];
      for (const p of rows) {
        lines.push(
          `  ${p.enabled ? '●' : '○'} ${p.id}  v${p.version || '-'}  ${p.entryCount} 个入口` +
            (p.error ? `  ! ${p.error}` : ''),
        );
      }
      return lines.join('\n');
    },
  })
  override async run(_ctx: ActionInput<this['_input']>) {
    return service.listPlugins();
  }
}
