// prompt.registry —— 注册表外露（方案 §5.3 / §7）：三端同源的唯一出口。
//
// CLI（nx-kv prompt registry）、HTTP（GET /api/prompt/registry）与设置页
// 消费同一份 uiDescriptor()：字段目录、生效模板、顺序位全部从插件声明 +
// DB 生效项派生，前端不再有手工副本（placeholders.ts / prompt-template-params.ts）。
//
// deps 全空：uiDescriptor 只读文本态（get()）与 schema 派生面（fields/writes），
// 结构态 data() 永不被调用——不需要宿主取数。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { getDb } from '../../../core/db/index.js';
import { readSettingRaw } from '../../../core/db/settings.js';
import { resolveBlockTemplates } from '../../../shared/prompt-blocks.js';
import { uiDescriptor } from '../../../shared/prompt-plugin.js';
import { buildDeliveryPlugins, PLUGIN_IDS } from '../factory.js';
import { templateBundle } from '../template-bundle.js';
import { ensurePromptTemplates } from '../ensure.js';
import { LT_BLOCK_TEMPLATES, PROMPT_ORDER_KEY } from '../keys.js';

/** prompt.registry 的入参契约（无参）。 */
const input = z.object({});

export class PromptRegistryAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.registry',
    cli: ['prompt', 'registry'],
    http: ['GET', '/api/prompt/registry'],
    summary: '提示词插件注册表：8 段的生效模板 / 变量目录 / 顺序位（三端同源，uiDescriptor 派生）',
    input,
    render: (d: any) =>
      d.plugins.map((p: any) => `${p.order} ${p.id}（${p.label}，标签 ${p.tag}）`).join('；'),
  })
  override async run(_ctx: ActionInput<this['_input']>) {
    const conn = getDb();
    // 自举兜底（幂等，版本相同零写）：注册表出口不依赖 localtask 的 open 链——
    // 纯 core store 上也必须能出注册表（方案的「全仓唯一落库调用点」仍是 open.ts）。
    let raw = readSettingRaw(conn, LT_BLOCK_TEMPLATES);
    if (raw === undefined) {
      ensurePromptTemplates(conn);
      raw = readSettingRaw(conn, LT_BLOCK_TEMPLATES);
    }
    const resolved = resolveBlockTemplates(raw ?? templateBundle());
    const plugins = buildDeliveryPlugins(resolved as any, {
      groupCtx: null, attach: null, queueInfo: null, loopText: '', waitMinutes: 0,
    });
    const orderIds = readSettingRaw(conn, PROMPT_ORDER_KEY);
    const pluginsDesc = uiDescriptor(plugins, Array.isArray(orderIds) ? orderIds : PLUGIN_IDS);
    return { plugins: pluginsDesc };
  }
}
