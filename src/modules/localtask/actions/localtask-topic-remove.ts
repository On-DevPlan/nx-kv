// localtask.topic.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.topic.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().optional().describe("工作目录（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key（与 --cwd 二选一）"),
  force: z.boolean().optional().describe("连等待中的主题也删（agent 将超时收尾）"),
});

export class LocaltaskTopicRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.topic.remove',
    cli: ['localtask', 'topic', 'remove'],
    http: ['DELETE', '/api/localtasks/topic'],
    summary: '删除整个主题（含全部任务；按 --cwd 或 --key，等待中需 --force）',
    input,
    render: (d: any) =>
      `已删除主题「${d.name}」（待领取/共 ${d.topic.pending}/${d.topic.total} 条任务一并删除）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeTopic({ cwd: ctx.cwd, key: ctx.key, force: ctx.force });
  
  }
}
