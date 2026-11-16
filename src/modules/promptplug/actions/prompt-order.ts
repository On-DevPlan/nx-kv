// prompt.order —— 顺序数组写入（方案 §5.1 / §5.3）。
//
// 唯一真相是数组：恰好包含全部插件 id 各一次、无未知 id；不合法即拒绝保存
// （UI 拖动重排后 PUT 这里，CLI 渲染顺序随之变化）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { getDb } from '../../../core/db/index.js';
import { writeSettingRaw } from '../../../core/db/settings.js';
import { assertOrder } from '../../../shared/prompt-plugin.js';
import { buildDeliveryPlugins } from '../factory.js';
import { PROMPT_ORDER_KEY } from '../keys.js';

/** prompt.order 的入参契约。 */
const input = z.object({
  order: z.array(z.string()).describe('顺序数组：恰好包含全部插件 id 各一次'),
});

export class PromptOrderAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.order',
    cli: ['prompt', 'order'],
    http: ['PUT', '/api/prompt/order'],
    summary: '写提示词插件顺序数组（唯一真相；必须恰好包含全部 8 个插件 id 各一次）',
    input,
    render: (d: any) => `顺序已保存：${d.order.join(' → ')}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const plugins = buildDeliveryPlugins({}, {
      groupCtx: null, attach: null, queueInfo: null, loopText: '', waitMinutes: 0,
    });
    // 只校验 id 集合不变量（模板为空串不影响 assertOrder / id 检查）
    assertOrder(plugins, ctx.order);
    const conn = getDb();
    writeSettingRaw(conn, PROMPT_ORDER_KEY, ctx.order);
    return { order: ctx.order };
  }
}
