// ext 插件（order 60）：待领取队列。变换薄（count>0 才进 ctx，空队列 null 段消失），
// 从 wait.ts 的 extCtx 组装搬入；pendingQueueInfo 的 I/O 由宿主完成后注入结果。
import { z } from 'zod';
import { PromptPlugin, supplied, type Supply, type TemplateText } from '../base.js';

// 内层字段全 optional：queueInfo 由宿主（pendingQueueInfo）构造，校验职责收敛在顶层段键。
// .describe() 是设置页变量目录显示的含义（schema-bridge 读它当 label）。
const queueItemShape = z.looseObject({
  id: z.number().optional().describe('任务号（localtask show --id）'),
  title: z.string().optional().describe('任务标题（正文首个非空行）'),
});

const schema = z.strictObject({
  ext: z
    .looseObject({
      topic: z.string().optional().describe('队列所属主题（工作目录名）'),
      count: z.number().optional().describe('还有多少条待领取任务'),
      list: z.array(queueItemShape).optional().describe('待领取任务清单（最多前几条）'),
    })
    .nullable()
    .describe('同主题剩余队列；空队列 → null（整段不输出）'),
});

/** 内置模板（#152：正文进代码）。 */
const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if ext.count}}
本队列（{{ext.topic}}）还有 {{ext.count}} 条待领取任务：
{{#each ext.list}}
  - #{{id}} {{title}}
{{/each}}
先完成当前任务，再领取下一条；不要因为后面还有活就提前收尾或分心。
{{/if}}`,
};

export class ExtPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'ext';
  readonly order = 60;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.ext';
  readonly label = '待领取队列（ext）';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  /** deps.queueInfo：pendingQueueInfo(topicKey, taskId) 的结果（读取失败 → null） */
  constructor(template: string, private readonly deps: { queueInfo: Supply<{ topic: string; count: number; list: { id: number; title: string }[] } | null> }) {
    super(template);
  }

  protected async buildData() {
    const q = await supplied(this.deps.queueInfo);
    return { ext: q && q.count > 0 ? { topic: q.topic, count: q.count, list: q.list } : null };
  }
}
