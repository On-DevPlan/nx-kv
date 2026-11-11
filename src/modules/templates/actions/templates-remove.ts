// templates.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { templatesRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
const service: any = serviceNs;

export class TemplatesRemoveAction extends ActionBase {
  @action({
    id: 'templates.remove',
    cli: ['template', 'remove'],
    http: ['DELETE', '/api/templates/:id'],
    summary: '删除任务模板（内置默认模板不可删；删的是默认模板则默认回落到内置）',
    args: ['id'],
    input: templatesRemoveInput,
    render: (d: any) => `已删除模板「${d.removed.name}」（${d.removed.id}）${d.wasDefault ? '，默认模板回落为内置' : ''}`,
  })
  async remove(ctx: any) {

      return service.removeTemplate({ id: ctx.id });
  
  }
}
