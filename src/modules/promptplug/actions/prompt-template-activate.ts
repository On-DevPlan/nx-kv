// prompt.template.activate —— 切换段启用的模板（#161）。
//
// 'builtin'（出厂第一条）或用户条目 id；装配时 factory 把启用正文传给插件构造。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { badInput } from '../../../core/errors.js';
import { pluginMeta } from '../registry.js';
import { activateTemplate } from '../template-store.js';

const input = z.object({
  segment: z.string().min(1).describe('段（插件 id）'),
  /** 'builtin' = 回出厂；否则须是已存在的用户条目 id */
  id: z.string().min(1).describe('模板 id（builtin 或用户条目）'),
});

export class PromptTemplateActivateAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.template.activate',
    cli: ['prompt', 'template', 'activate'],
    http: ['POST', '/api/prompt/template/activate'],
    summary: '切换提示词段启用的模板（builtin 或用户条目）',
    input,
    render: (d: any) => `[${d.segment}] 已启用模板：${d.activeId}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    if (!pluginMeta(ctx.segment)) throw badInput(`未知提示词段：${ctx.segment}`);
    const seg = activateTemplate(ctx.segment, String(ctx.id));
    return { segment: ctx.segment, ...seg };
  }
}
