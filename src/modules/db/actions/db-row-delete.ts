// db.rowDelete —— #287 调试模式行级 CRUD：按行地址（主键/rowid）删除一行。
// 仅 serve --debug 可用；表过 PRAGMA 白名单，值参数绑定。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../crud.js';
const service: any = serviceNs;

/** db.rowDelete 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  table: z.string().describe('目标表名（须为库内用户表）'),
  rowid: z.union([z.number(), z.string()]).describe('行地址：主键值或 rowid'),
});

export class DbRowDeleteAction extends ActionBase<typeof input> {
  @action({
    id: 'db.rowDelete',
    cli: ['db', 'row-delete'],
    http: ['POST', '/api/db/row-delete'],
    summary: '删除一行（仅调试模式：nx-kv serve --debug）',
    input,
    render: (d: any) => `已删除 ${d.table} ${d.changed} 行`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.rowDelete({ table: ctx.table, rowid: ctx.rowid });
  }
}
