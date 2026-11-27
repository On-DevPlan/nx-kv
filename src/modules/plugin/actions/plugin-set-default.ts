import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const input = z.object({
  scopeKey: z.string().describe('topic:<key> / repo:<key> / group:<key>'),
  entryId: z.string().optional().describe('入口 id（可省略；省略 = 跟随插件声明的默认）'),
});

export class PluginSetDefaultAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.set-default',
    cli: ['plugin', 'set-default'],
    http: ['POST', '/api/plugins/default'],
    summary: '设某个 scope 的「新建页」默认入口（空 entryId = 跟随插件默认）',
    input,
    render: (d: any) => `已设 ${d?.scopeKey || ''} 的默认入口：${d?.defaultEntryId || '跟随插件默认'}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.setDefaultEntry(ctx.scopeKey, String(ctx.entryId || ''));
  }
}
