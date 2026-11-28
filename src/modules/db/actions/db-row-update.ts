// db.rowUpdate —— #287 调试模式行级 CRUD：按行地址（主键/rowid）更新指定列。
// 仅 serve --debug 可用（service.requireDebugMode 守卫）；表/列过 PRAGMA 白名单，值参数绑定。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../crud.js';
const service: any = serviceNs;

/** db.rowUpdate 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  table: z.string().describe('目标表名（须为库内用户表）'),
  rowid: z.union([z.number(), z.string()]).describe('行地址：主键值或 rowid'),
  changes: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .describe('要更新的列 → 新值（按 rowid 寻址，主键列也可改）'),
});

export class DbRowUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'db.rowUpdate',
    cli: ['db', 'row-update'],
    http: ['POST', '/api/db/row-update'],
    summary: '更新一行（仅调试模式：nx-kv serve --debug）',
    input,
    render: (d: any) => `已更新 ${d.table} ${d.changed} 行`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.rowUpdate({ table: ctx.table, rowid: ctx.rowid, changes: ctx.changes });
  }
}
