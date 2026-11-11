// topic.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { topicListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TopicListAction extends ActionBase {
  @action({
    id: 'topic.list',
    cli: ['topic', 'list'],
    http: ['GET', '/api/topics'],
    summary: '快捷主题列表（含各状态任务数）',
    input: topicListInput,
    render: (list: any) => {
        if (!list.length) return '（暂无快捷主题）';
        const w: any = Math.max(...list.map((t: any) => t.name.length));
        return list
          .map((t: any) => `${t.name.padEnd(w)}  待办 ${t.open}  完成 ${t.done}  冻结 ${t.freeze}`)
          .join('\n');
      },
  })
  async list(ctx: any) {

      return service.listTopics({ groupId: ctx.group });
  
  }
}
