// topic.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** topic.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TopicListAction extends ActionBase<typeof input> {
  @action({
    id: 'topic.list',
    cli: ['topic', 'list'],
    http: ['GET', '/api/topics'],
    summary: '快捷主题列表（含各状态任务数）',
    input,
    render: (list: any) => {
        if (!list.length) return '（暂无快捷主题）';
        const w: any = Math.max(...list.map((t: any) => t.name.length));
        return list
          .map((t: any) => `${t.name.padEnd(w)}  待办 ${t.open}  完成 ${t.done}  冻结 ${t.freeze}`)
          .join('\n');
      },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listTopics({ groupId: ctx.group });
  
  }
}
