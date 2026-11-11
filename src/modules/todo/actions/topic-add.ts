// topic.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { topicAddInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TopicAddAction extends ActionBase<typeof topicAddInput> {
  @action({
    id: 'topic.add',
    cli: ['topic', 'add'],
    http: ['POST', '/api/topics'],
    summary: '加入快捷主题',
    args: ['name'],
    input: topicAddInput,
    render: (d: any) => (d.added ? `已加入快捷主题: ${d.name}` : `${d.name} 已在快捷列表中`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addTopic(ctx.name, { groupId: ctx.group });
  
  }
}
