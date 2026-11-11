// templates.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { templatesListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderList } from '../support.js';
const service: any = serviceNs;

export class TemplatesListAction extends ActionBase {
  @action({
    id: 'templates.list',
    cli: ['template', 'list'],
    http: ['GET', '/api/templates'],
    summary: '列出任务模板（含默认模板 id；新建页的起始正文按默认模板取）',
    input: templatesListInput,
    render: renderList,
  })
  async list(ctx: any) {

      return ctx.topic || ctx.group || ctx.repo
            ? service.listTemplatesForTopic({ topic: ctx.topic, group: ctx.group, repo: ctx.repo })
            : service.listTemplates();
  
  }
}
