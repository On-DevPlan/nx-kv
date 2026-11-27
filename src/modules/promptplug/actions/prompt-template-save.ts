// prompt.template.save —— 保存段模板（新建 / 编辑用户条目）（#161）。
//
// 每段可有多个模板：出厂 builtin（代码内，不可改）+ 用户条目（本 action 落盘）。
// 保存前先按该段变量白名单校验正文——坏模板不许落盘，否则运行期每轮渲染 throw。
// 新建即启用；编辑启用中的条目即时生效。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { badInput } from '../../../core/errors.js';
import { pluginMeta } from '../registry.js';
import { varScopeOf as varScopeOfFields, undeclaredTemplateVars } from '../../../shared/prompt-plugin.js';
import { externalSegmentOf } from '../external.js';
import { upsertTemplate } from '../template-store.js';

const input = z.object({
  /** 段（插件 id，如 timecheck / doneguard） */
  segment: z.string().min(1).describe('段（插件 id）'),
  /** 条目 id；缺省 = 新建（复制场景前端先拉原文再不带 id 提交） */
  id: z.string().optional().describe('用户条目 id；缺省新建'),
  name: z.string().optional().describe('模板名（缺省「未命名模板」）'),
  text: z.string().min(1).describe('模板正文（Handlebars 子集）'),
});

export class PromptTemplateSaveAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.template.save',
    cli: ['prompt', 'template', 'save'],
    http: ['POST', '/api/prompt/template/save'],
    summary: '保存提示词段模板（新建/编辑用户条目；保存前按该段变量白名单校验）',
    input,
    render: (d: any) => `[${d.segment}] 模板已保存：${d.activeId}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const p = pluginMeta(ctx.segment);
    // 内置段走类声明；外部段（gettask 插件区块）走宿主注册进来的声明面。
    // 两边共用同一套「seed ∪ 本段字段」白名单——坏模板不许落盘。
    let scope: { allowedSegments: string[]; fieldKeys: string[] };
    if (p) {
      scope = varScopeOfFields(ctx.segment, p.schema.fields);
    } else {
      const ext = await externalSegmentOf(ctx.segment);
      if (!ext) throw badInput(`未知提示词段：${ctx.segment}`);
      scope = varScopeOfFields(ctx.segment, ext.fields);
    }
    const stray = undeclaredTemplateVars(String(ctx.text), scope.allowedSegments, scope.fieldKeys);
    if (stray.length) {
      throw badInput(
        `模板引用了本段没有的变量 ${stray.join(', ')}（每段只能引用 seed（${scope.allowedSegments.join(' / ')}）与自己的 dataSchema 字段）`,
      );
    }
    const seg = upsertTemplate({
      segment: ctx.segment,
      id: ctx.id,
      name: ctx.name,
      text: String(ctx.text),
    });
    return { segment: ctx.segment, ...seg };
  }
}
