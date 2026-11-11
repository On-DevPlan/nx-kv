// templates.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { templatesAddInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseScope, topicFromCwd } from '../support.js';
const service: any = serviceNs;

export class TemplatesAddAction extends ActionBase {
  @action({
    id: 'templates.add',
    cli: ['template', 'add'],
    http: ['POST', '/api/templates'],
    summary: '新增任务模板（--body 给 Markdown 正文；多行正文用 --body-file <文件> 或 --body - 读管道；--setDefault 同时设为默认；--scope 设可见域、--topic 记创建主题并默认仅该主题可见）',
    args: ['name'],
    input: templatesAddInput,
    render: (d: any) =>
        `已新增模板「${d.template.name}」（${d.template.id}）${d.defaultId === d.template.id ? '，并设为默认' : ''}${
          Array.isArray(d.template.scope) && !d.template.scope.includes('*')
            ? `，可见域 ${JSON.stringify(d.template.scope)}`
            : ''
        }`,
  })
  async add(ctx: any, opts: any = {}) {

      return service.addTemplate({
            name: ctx.name,
            body: ctx.body,
            bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']),
            setDefault: ctx.setDefault ?? ctx['set-default'],
            scope: parseScope(ctx.scope),
            topic: ctx.topic || topicFromCwd(ctx.cwd),
          });
  
  }
}
