// templates.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { templatesUpdateInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseScope, parseValues } from '../support.js';
const service: any = serviceNs;

export class TemplatesUpdateAction extends ActionBase {
  @action({
    id: 'templates.update',
    cli: ['template', 'update'],
    http: ['PATCH', '/api/templates/:id'],
    summary: '编辑任务模板（--name 改名 / --body 改正文 / --scope 改可见域，只改传入项；多行正文用 --body-file；内置模板的正文也可改）',
    args: ['id'],
    input: templatesUpdateInput,
    render: (d: any) => `已更新模板「${d.template.name}」（${d.template.id}）`,
  })
  async update(ctx: any, opts: any = {}) {

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
