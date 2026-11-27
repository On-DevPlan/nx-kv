import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

const entry = z.object({
  entryId: z.string(),
  visible: z.boolean(),
  sortOrder: z.number().int().optional(),
});

function entriesOf(raw: unknown): { entryId: string; visible: boolean; sortOrder?: number }[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('entries 需要 JSON 数组（形如 [{"entryId":"task-template:ref","visible":true}]）');
    }
  }
  if (!Array.isArray(value)) throw new Error('entries 需要数组');
  return value.map((item) => entry.parse(item));
}

const input = z.object({
  scopeKey: z.string().describe('topic:<key> / repo:<key> / group:<key>'),
  entries: z.unknown().describe('[{ entryId, visible, sortOrder? }]（CLI 可传 JSON 字符串）'),
});

export class PluginSetVisibilityAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.set-visibility',
    cli: ['plugin', 'set-visibility'],
    http: ['PATCH', '/api/plugins/visibility'],
    summary: '写某个 scope 的入口可见性与顺序',
    input,
    render: (d: any) => `已保存 ${d?.scopeKey || ''} 的 ${(d?.entries || []).length} 条入口可见性`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.setVisibility(ctx.scopeKey, entriesOf(ctx.entries));
  }
}
