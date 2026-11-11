// prompt.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** prompt.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  topic: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class PromptRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.remove',
    cli: ['prompt', 'remove'],
    http: ['DELETE', '/api/prompts/:topic'],
    summary: '删除某主题的提示词',
    args: ['topic'],
    input,
    render: (d: any) => (d.removed ? `已删除 ${d.topic} 的提示词` : `${d.topic} 本就没有提示词`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removePrompt(ctx.topic, { groupId: ctx.group });
  
  }
}
