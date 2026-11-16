// getloop 插件（order 80）：持续 get。
// deps.loopText 是宿主先把「项目级收尾指令模板」渲染好的文本（wait.ts 保留这一步
// 与其 renderWarnings 告警口径）；waitMinutes=0 时模板闸门 {{#if (gt …)}} 收口。
import { z } from 'zod';
import { PromptPlugin } from '../base.js';

const schema = z.strictObject({
  getloop: z.looseObject({ text: z.string(), waitMinutes: z.number() }).nullable(),
  // 可见 seed 变量（{{task.id}}），data() 不返回它
  task: z.looseObject({ id: z.number(), text: z.string() }).optional().nullable(),
});

export class GetloopPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'getloop';
  readonly order = 80;
  readonly tag = 'nx-kv.getloop';
  readonly label = '持续 get';
  override readonly writes = ['getloop'];
  readonly dataSchema = schema;

  constructor(template: string, private readonly deps: { loopText: string; waitMinutes: number }) {
    super(template);
  }

  protected data() {
    const text = String(this.deps.loopText || '').trim();
    return { getloop: text ? { text, waitMinutes: Number(this.deps.waitMinutes) || 0 } : null };
  }
}
