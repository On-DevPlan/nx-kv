// prompt.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { promptSetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class PromptSetAction extends ActionBase {
  @action({
    id: 'prompt.set',
    cli: ['prompt', 'set'],
    http: ['POST', '/api/prompts/:topic'],
    summary: '写入某主题的上下文提示词（覆盖）',
    args: ['topic', 'text'],
    input: promptSetInput,
    render: (d: any) => `已写入 ${d.topic} 的提示词（${d.bytes} 字节）`,
  })
  async set(ctx: any) {

      return service.setPrompt(ctx.topic, ctx.text, { groupId: ctx.group });
  
  }
}
