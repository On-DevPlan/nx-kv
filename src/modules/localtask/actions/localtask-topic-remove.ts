// localtask.topic.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskTopicRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskTopicRemoveAction extends ActionBase {
  @action({
    id: 'localtask.topic.remove',
    cli: ['localtask', 'topic', 'remove'],
    http: ['DELETE', '/api/localtasks/topic'],
    summary: '删除整个主题（含全部任务；按 --cwd 或 --key，等待中需 --force）',
    input: localtaskTopicRemoveInput,
    render: (d: any) =>
      `已删除主题「${d.name}」（待领取/共 ${d.topic.pending}/${d.topic.total} 条任务一并删除）`,
  })
  async remove(ctx: any) {

      return service.removeTopic({ cwd: ctx.cwd, key: ctx.key, force: ctx.force });
  
  }
}
