// templates.default —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseValues, parseScope } from '../support.js';
const service: any = serviceNs;

/** templates.default 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名字（配合 --body/--scope 时改默认模板本身）"),
  body: z.string().optional().describe("新正文（配合时改默认模板本身）"),
  values: z.unknown().optional().describe("槽位值 JSON（CLI 传 JSON 串；HTTP 可直接给对象）"),
  scope: z.unknown().optional().describe("可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写"),
});

export class TemplatesDefaultAction extends ActionBase<typeof input> {
  @action({
    id: 'templates.default',
    cli: ['template', 'default'],
    http: ['PATCH', '/api/templates/default'],
    summary: '设置默认模板（新建页的起始正文换成它）；带 --body/--name/--scope 则改默认模板本身',
    args: ['id'],
    input,
    render: (d: any) => `默认模板已设为「${d.template.name}」（${d.template.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

          if (
            ctx.body !== undefined || ctx.name !== undefined ||
            ctx.values !== undefined || ctx.scope !== undefined
          ) {
            return service.updateTemplate({
              id: ctx.id || 'default',
              name: ctx.name,
              body: ctx.body,
              values: parseValues(ctx.values),
              scope: parseScope(ctx.scope),
            });
          }
          return service.setDefaultTemplate({ id: ctx.id });
      
  }
}
