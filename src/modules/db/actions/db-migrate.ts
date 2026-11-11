// db.migrate —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { dbMigrateInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class DbMigrateAction extends ActionBase {
  @action({
    id: 'db.migrate',
    cli: ['db', 'migrate'],
    http: null,
    summary: '迁移：无标志 = 从 legacy JSON 全量导入；版本落后 = 走升级链（含 --dry-run 演练）',
    input: dbMigrateInput,
    render: (d: any) => service.renderMigrate(d),
  })
  async migrate(ctx: any) {

      return service.migrate({ dryRun: ctx['dry-run'] === true, apply: ctx.apply === true });
  
  }
}
