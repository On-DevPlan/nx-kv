// db.migrate —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** db.migrate 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  'dry-run': z.boolean().optional().describe("演练：事务末尾回滚，库与 JSON 都不改"),
  apply: z.boolean().optional().describe("显式执行（默认就是执行，此标志让脚本自证意图）"),
});

export class DbMigrateAction extends ActionBase<typeof input> {
  @action({
    id: 'db.migrate',
    cli: ['db', 'migrate'],
    http: null,
    summary: '迁移：无标志 = 从 legacy JSON 全量导入；版本落后 = 走升级链（含 --dry-run 演练）',
    input,
    render: (d: any) => service.renderMigrate(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.migrate({ dryRun: ctx['dry-run'] === true, apply: ctx.apply === true });
  
  }
}
