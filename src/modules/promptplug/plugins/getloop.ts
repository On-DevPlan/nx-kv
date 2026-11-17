// getloop 插件（order 80）：持续 get。
// deps.loopText 是宿主先把「项目级收尾指令模板」渲染好的文本（wait.ts 保留这一步
// 与其 renderWarnings 告警口径）；waitMinutes=0 时模板闸门 {{#if (gt …)}} 收口。
import { z } from 'zod';
import { PromptPlugin, supplied, type Supply, type TemplateText } from '../base.js';

const schema = z.strictObject({
  getloop: z.looseObject({ text: z.string(), waitMinutes: z.number() }).nullable(),
  // 可见 seed 变量（{{task.id}}），data() 不返回它
  task: z.looseObject({ id: z.number(), text: z.string() }).optional().nullable(),
});

/** 内置模板（#152：正文进代码）。 */
const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if getloop}}
{{#if task}}不要直接结束本轮：完成上面的任务（{{task.id}}）之后，继续调用 nx-kv localtask get 领取下一条任务。队列里有活会立即返回；{{#if (gt getloop.waitMinutes 0)}}没活时每次最多阻塞 {{getloop.waitMinutes}} 分钟，直到 get 返回 timeout 为止。{{/if}}{{/if}}
{{/if}}`,
};

export class GetloopPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'getloop';
  readonly order = 80;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.getloop';
  readonly label = '持续 get';
  override readonly writes = ['getloop'];
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template: string, private readonly deps: { loopText: Supply<string>; waitMinutes: Supply<number> }) {
    super(template);
  }

  protected async buildData() {
    const text = String(await supplied(this.deps.loopText) || '').trim();
    const waitMinutes = Number(await supplied(this.deps.waitMinutes)) || 0;
    return { getloop: text ? { text, waitMinutes } : null };
  }
}
