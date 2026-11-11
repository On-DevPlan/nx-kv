// topic.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { topicRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TopicRemoveAction extends ActionBase {
  @action({
    id: 'topic.remove',
    cli: ['topic', 'remove'],
    http: ['DELETE', '/api/topics'],
    summary: '移出快捷主题（不动已有任务；仍被任务使用时会在结果里提示）',
    args: ['name'],
    input: topicRemoveInput,
    render: (d: any) => {
        if (!d.removed) return `${d.name} 本就不在快捷列表中`;
        return d.inUse
          ? `已移出快捷主题: ${d.name}\n注意: 仍有 ${d.inUse} 条任务在用它，主题名不会消失，只是不再出现在候选里`
          : `已移出快捷主题: ${d.name}`;
      },
  })
  async remove(ctx: any) {

      return service.removeTopic(ctx.name, { groupId: ctx.group });
  
  }
}
