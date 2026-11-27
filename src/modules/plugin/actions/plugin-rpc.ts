import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';
import { sanitizeContext } from '../context.js';

function paramsOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

const input = z.object({
  pluginId: z.string().describe('插件 id'),
  method: z.string().describe('插件 rpc 方法名'),
  params: z.unknown().optional().describe('参数对象（CLI 可传 JSON 字符串）'),
  ctx: z.unknown().optional().describe('宿主页面注入的 topic 上下文（插件 server 用）'),
});

export class PluginRpcAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.rpc',
    cli: ['plugin', 'rpc'],
    http: ['POST', '/api/plugins/rpc'],
    summary: '调用插件自有 RPC（插件管理页用；例如 task-template 的模板 CRUD）',
    input,
    render: (d: any) => JSON.stringify(d ?? null, null, 2),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.callRpc(ctx.pluginId, ctx.method, paramsOf(ctx.params), sanitizeContext(ctx.ctx));
  }
}
