// bundled.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { bundledGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { exclusive, renderContent } from '../support.js';
const service: any = serviceNs;

export class BundledGetAction extends ActionBase<typeof bundledGetInput> {
  @action({
    id: 'bundled.get',
    cli: ['skill', 'get'],
    http: ['GET', '/api/bundled/content'],
    summary: '输出内置 skill 全文（prefix + sentinel + 正文 + install 状态），并顺手装到本机',
    args: ['name', 'ref'],
    input: bundledGetInput,
    render: (d: any) => (d.group
        ? d.skills.map(renderContent).join('\n\n' + '─'.repeat(60) + '\n\n')
        : renderContent(d)),
  })
  override async run(ctx: ActionInput<this['_input']>) {

          exclusive(ctx, 'skill get');
          return service.bundledSkillContent({ name: ctx.name, group: ctx.group, ref: ctx.ref, to: ctx.to });
      
  }
}
