// templates.default —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { templatesDefaultInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseValues, parseScope } from '../support.js';
const service: any = serviceNs;

export class TemplatesDefaultAction extends ActionBase<typeof templatesDefaultInput> {
  @action({
    id: 'templates.default',
    cli: ['template', 'default'],
    http: ['PATCH', '/api/templates/default'],
    summary: '设置默认模板（新建页的起始正文换成它）；带 --body/--name/--scope 则改默认模板本身',
    args: ['id'],
    input: templatesDefaultInput,
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
