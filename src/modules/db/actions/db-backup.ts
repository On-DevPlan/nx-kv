// db.backup —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { dbBackupInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class DbBackupAction extends ActionBase {
  @action({
    id: 'db.backup',
    cli: ['db', 'backup'],
    http: null,
    summary: 'VACUUM INTO 备份（WAL 下不能直接 copy .db；保留最近 5 份）',
    input: dbBackupInput,
    render: (d: any) => service.renderBackup(d),
  })
  async backup(ctx: any) {

      return service.backup({ dir: ctx.dir, keep: ctx.keep });
  
  }
}
