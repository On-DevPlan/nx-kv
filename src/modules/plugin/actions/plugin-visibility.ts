import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const input = z.object({
  scopeKey: z.string().describe('topic:<key> / repo:<key> / group:<key>'),
});

export class PluginVisibilityAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.visibility',
    cli: ['plugin', 'visibility'],
    http: ['GET', '/api/plugins/visibility'],
    summary: '读某个 scope 的入口可见性 / 顺序 / 默认入口（管理页用）',
    input,
    render: (d: any) => {
      const rows = Array.isArray(d?.entries) ? d.entries : [];
      return [
        `${d?.scopeKey || ''}：${rows.length} 条可见性配置；新建页默认：${d?.defaultEntryId || '跟随插件默认'}`,
        ...rows.map((r: any) => `  ${r.visible ? '●' : '○'} ${r.isDefault ? '★' : ' '} ${r.entryId}  #${r.sortOrder}`),
      ].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.getVisibility(ctx.scopeKey);
  }
}
