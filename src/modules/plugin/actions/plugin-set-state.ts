import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const input = z.object({
  id: z.string().describe('插件 id（plugin list 可查）'),
  enabled: z.boolean().describe('true = 启用，false = 关闭'),
});

export class PluginSetStateAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.set-state',
    cli: ['plugin', 'set'],
    http: ['PATCH', '/api/plugins/state'],
    summary: '启用 / 关闭某个内部插件（全局开关；各 topic 的入口可见性另配）',
    input,
    render: (d: any) => {
      const hit = Array.isArray(d) ? d.find((p: any) => p.enabled) : null;
      return `已更新插件开关${hit ? `：${hit.name}` : ''}`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.setPluginEnabled(ctx.id, ctx.enabled);
  }
}
