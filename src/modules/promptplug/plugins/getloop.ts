// getloop 插件（order 80）：持续 get。
// deps.enabled 是宿主从 waitgoal 配置（repos.json repo.getLoop）读出的开关；
// 关 → 整段不出。#230 清理：原「宿主预渲染 loopText → data.getloop.text」链路
// 已删——#182 起项目级 template 口子下线，文案唯一真相就是本类的内置模板
// （预渲染上下文缺 getloop 键，产出的 text 是残缺副本，BUILTIN 也从不消费它）。
import { z } from 'zod';
import { PromptPlugin, supplied, type Supply, type TemplateText } from '../base.js';

const schema = z.strictObject({
  getloop: z
    .looseObject({
      waitMinutes: z.number().describe('没活时每次阻塞的分钟数（0 = 不阻塞）'),
    })
    .nullable()
    .describe('项目级持续 get；未开启 → null（整段不输出）'),
  // 可见 seed 变量（{{task.id}}），data() 不返回它
  task: z
    .looseObject({ id: z.number().describe('任务号'), text: z.string().describe('任务正文原文') })
    .optional()
    .nullable()
    .describe('当前任务（seed，宿主传入）'),
});

/** 内置模板（#152：正文进代码；#230 起它就是「继续 get」文案的唯一真相）。 */
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
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template: string, private readonly deps: { enabled: Supply<boolean>; waitMinutes: Supply<number> }) {
    super(template);
  }

  protected async buildData() {
    const enabled = !!(await supplied(this.deps.enabled));
    const waitMinutes = Number(await supplied(this.deps.waitMinutes)) || 0;
    return { getloop: enabled ? { waitMinutes } : null };
  }
}
