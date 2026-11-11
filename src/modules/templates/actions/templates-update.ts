// templates.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseScope, parseValues } from '../support.js';
const service: any = serviceNs;

/** templates.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名字（不传保持不变）"),
  body: z.string().optional().describe("新正文（Markdown；不传保持不变）"),
  bodyFile: z.string().optional().describe("从文件读新正文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
  scope: z.unknown().optional().describe("可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写（不传保持不变）"),
  values: z.string().optional().describe("槽位值 JSON（形如 {\"背景\":\"要做的事\"}）——老模板正文里的 {{槽位名}} 处填这段文字（新模板直接写正文即可）"),
});

export class TemplatesUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'templates.update',
    cli: ['template', 'update'],
    http: ['PATCH', '/api/templates/:id'],
    summary: '编辑任务模板（--name 改名 / --body 改正文 / --scope 改可见域，只改传入项；多行正文用 --body-file；内置模板的正文也可改）',
    args: ['id'],
    input,
    render: (d: any) => `已更新模板「${d.template.name}」（${d.template.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return service.updateTemplate({
            id: ctx.id,
            name: ctx.name,
            body: ctx.body,
            bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']),
            scope: parseScope(ctx.scope),
            values: parseValues(ctx.values),
          });
  
  }
}
