// prompt.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { promptGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class PromptGetAction extends ActionBase<typeof promptGetInput> {
  @action({
    id: 'prompt.get',
    cli: ['prompt', 'get'],
    http: ['GET', '/api/prompts/:topic'],
    summary: '读取某主题的上下文提示词',
    args: ['topic'],
    input: promptGetInput,
    render: (d: any) => (d.hasPrompt ? d.prompt : `（${d.topic} 没有配置提示词）`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getPrompt(ctx.topic, { groupId: ctx.group });
  
  }
}
