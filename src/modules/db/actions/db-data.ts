// db.data —— 库数据只读导出：不带 --table 给全表概览（行数 + 列清单），
// 带 --table 给该表的行窗口（LIMIT/OFFSET 分页）。面板「数据库」页的数据源。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** db.data 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  table: z.string().optional().describe('只看这张表（缺省给全表概览）'),
  limit: z.number().default(200).describe('行窗口大小（1–1000，缺省 200）'),
  offset: z.number().default(0).describe('行窗口起点（缺省 0）'),
});

export class DbDataAction extends ActionBase<typeof input> {
  @action({
    id: 'db.data',
    cli: ['db', 'data'],
    http: ['GET', '/api/db/data'],
    summary: '库数据只读导出：全表概览或单表行窗口（不触发导入、不升级）',
    input,
    render: (d: any) => service.renderData(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.data({ table: ctx.table, limit: ctx.limit, offset: ctx.offset });
  }
}
