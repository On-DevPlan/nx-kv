// todo.archive —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** todo.archive 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  before: z.string().optional().describe("截止日期，如 2026-08-01"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoArchiveAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.archive',
    cli: ['todo', 'archive'],
    http: ['POST', '/api/todo/archive'],
    summary: '把已完成里较旧的条目归档到冷 key（默认 30 天前）',
    input,
    render: (d: any) =>
        d.moved
          ? `已归档 ${d.moved} 条 -> ${d.coldKey}（已完成剩 ${d.remaining} 条，冷 key 共 ${d.total} 条）`
          : '没有需要归档的条目',
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.archiveDone({ before: ctx.before, groupId: ctx.group });
  
  }
}
