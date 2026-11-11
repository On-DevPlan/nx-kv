// templates.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderList } from '../support.js';
const service: any = serviceNs;

/** templates.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  topic: z.string().optional().describe("按队列 topics.key 过滤（可与 --group/--repo 组合；响应带 scoped:true）"),
  group: z.string().optional().describe("按项目组 repos.key 过滤（#132：组本身是可见主体，与 topic/repo 平级）"),
  repo: z.string().optional().describe("按项目 repos.key 过滤"),
});

export class TemplatesListAction extends ActionBase<typeof input> {
  @action({
    id: 'templates.list',
    cli: ['template', 'list'],
    http: ['GET', '/api/templates'],
    summary: '列出任务模板（含默认模板 id；新建页的起始正文按默认模板取）',
    input,
    render: renderList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return ctx.topic || ctx.group || ctx.repo
            ? service.listTemplatesForTopic({ topic: ctx.topic, group: ctx.group, repo: ctx.repo })
            : service.listTemplates();
  
  }
}
