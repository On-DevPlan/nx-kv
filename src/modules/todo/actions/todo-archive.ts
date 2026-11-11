// todo.archive —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { todoArchiveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class TodoArchiveAction extends ActionBase {
  @action({
    id: 'todo.archive',
    cli: ['todo', 'archive'],
    http: ['POST', '/api/todo/archive'],
    summary: '把已完成里较旧的条目归档到冷 key（默认 30 天前）',
    input: todoArchiveInput,
    render: (d: any) =>
        d.moved
          ? `已归档 ${d.moved} 条 -> ${d.coldKey}（已完成剩 ${d.remaining} 条，冷 key 共 ${d.total} 条）`
          : '没有需要归档的条目',
  })
  async archive(ctx: any) {

      return service.archiveDone({ before: ctx.before, groupId: ctx.group });
  
  }
}
