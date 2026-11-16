// ext 插件（order 60）：待领取队列。变换薄（count>0 才进 ctx，空队列 null 段消失），
// 从 wait.ts 的 extCtx 组装搬入；pendingQueueInfo 的 I/O 由宿主完成后注入结果。
import { z } from 'zod';
import { PromptPlugin } from '../base.js';

const schema = z.strictObject({
  // 内层字段全 optional：queueInfo 由宿主（pendingQueueInfo）构造，校验职责收敛在顶层段键
  ext: z.looseObject({
    topic: z.string().optional(),
    count: z.number().optional(),
    list: z.array(z.looseObject({ id: z.number().optional(), title: z.string().optional() })).optional(),
  }).nullable(),
});

export class ExtPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'ext';
  readonly order = 60;
  readonly tag = 'nx-kv.ext';
  readonly label = '待领取队列（ext）';
  override readonly writes = ['ext'];
  readonly dataSchema = schema;

  /** deps.queueInfo：pendingQueueInfo(topicKey, taskId) 的结果（读取失败 → null） */
  constructor(template: string, private readonly deps: { queueInfo: { topic: string; count: number; list: { id: number; title: string }[] } | null }) {
    super(template);
  }

  protected data() {
    const q = this.deps.queueInfo;
    return { ext: q && q.count > 0 ? { topic: q.topic, count: q.count, list: q.list } : null };
  }
}
