// prompt.template.delete —— 删除一条用户段模板（#161）。
//
// 删的是启用条目时自动回落 builtin；builtin 不在内（不在 store），删不到。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { badInput } from '../../../core/errors.js';
import { pluginMeta } from '../registry.js';
import { deleteTemplate } from '../template-store.js';

const input = z.object({
  segment: z.string().min(1).describe('段（插件 id）'),
  id: z.string().min(1).describe('用户条目 id'),
});

export class PromptTemplateDeleteAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.template.delete',
    cli: ['prompt', 'template', 'delete'],
    http: ['POST', '/api/prompt/template/delete'],
    summary: '删除提示词段的用户模板（启用中的删除后回落 builtin）',
    input,
    render: (d: any) => `[${d.segment}] 模板已删除（当前启用：${d.activeId}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    if (!pluginMeta(ctx.segment)) throw badInput(`未知提示词段：${ctx.segment}`);
    const seg = deleteTemplate(ctx.segment, String(ctx.id));
    return { segment: ctx.segment, ...seg };
  }
}
