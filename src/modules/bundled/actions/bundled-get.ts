// bundled.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { exclusive, renderContent } from '../support.js';
const service: any = serviceNs;

/** bundled.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  name: z.string().optional(),
  ref: z.string().optional(),
  group: z.string().optional().describe("groups.json 里的组名（与 <name> 互斥）"),
  to: z.string().optional(),
});

export class BundledGetAction extends ActionBase<typeof input> {
  @action({
    id: 'bundled.get',
    cli: ['skill', 'get'],
    http: ['GET', '/api/bundled/content'],
    summary: '输出内置 skill 全文（prefix + sentinel + 正文 + install 状态），并顺手装到本机',
    args: ['name', 'ref'],
    input,
    render: (d: any) => (d.group
        ? d.skills.map(renderContent).join('\n\n' + '─'.repeat(60) + '\n\n')
        : renderContent(d)),
  })
  override async run(ctx: ActionInput<this['_input']>) {

          exclusive(ctx, 'skill get');
          return service.bundledSkillContent({ name: ctx.name, group: ctx.group, ref: ctx.ref, to: ctx.to });
      
  }
}
