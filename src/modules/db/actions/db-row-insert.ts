// db.rowInsert —— #287 调试模式行级 CRUD：插入一行（缺省列交 SQLite 默认值）。
// 仅 serve --debug 可用；表/列过 PRAGMA 白名单，值参数绑定。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../crud.js';
const service: any = serviceNs;

/** db.rowInsert 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  table: z.string().describe('目标表名（须为库内用户表）'),
  values: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .describe('列 → 值（至少一列；未给的列用表默认值）'),
});

export class DbRowInsertAction extends ActionBase<typeof input> {
  @action({
    id: 'db.rowInsert',
    cli: ['db', 'row-insert'],
    http: ['POST', '/api/db/row-insert'],
    summary: '插入一行（仅调试模式：nx-kv serve --debug）',
    input,
    render: (d: any) => `已插入 ${d.table}（rowid=${d.rowid ?? '-'}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.rowInsert({ table: ctx.table, values: ctx.values });
  }
}
