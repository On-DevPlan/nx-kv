// topic.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** topic.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  name: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TopicAddAction extends ActionBase<typeof input> {
  @action({
    id: 'topic.add',
    cli: ['topic', 'add'],
    http: ['POST', '/api/topics'],
    summary: '加入快捷主题',
    args: ['name'],
    input,
    render: (d: any) => (d.added ? `已加入快捷主题: ${d.name}` : `${d.name} 已在快捷列表中`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addTopic(ctx.name, { groupId: ctx.group });
  
  }
}
