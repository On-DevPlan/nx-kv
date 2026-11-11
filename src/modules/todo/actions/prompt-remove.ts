// prompt.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { promptRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class PromptRemoveAction extends ActionBase {
  @action({
    id: 'prompt.remove',
    cli: ['prompt', 'remove'],
    http: ['DELETE', '/api/prompts/:topic'],
    summary: '删除某主题的提示词',
    args: ['topic'],
    input: promptRemoveInput,
    render: (d: any) => (d.removed ? `已删除 ${d.topic} 的提示词` : `${d.topic} 本就没有提示词`),
  })
  async remove(ctx: any) {

      return service.removePrompt(ctx.topic, { groupId: ctx.group });
  
  }
}
