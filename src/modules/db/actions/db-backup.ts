// db.backup —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** db.backup 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  dir: z.string().optional().describe("备份目录（缺省 ~/.nx-kv/backups/）"),
  keep: z.number().default(5).describe("保留最近几份（0 = 不清理）"),
});

export class DbBackupAction extends ActionBase<typeof input> {
  @action({
    id: 'db.backup',
    cli: ['db', 'backup'],
    http: null,
    summary: 'VACUUM INTO 备份（WAL 下不能直接 copy .db；保留最近 5 份）',
    input,
    render: (d: any) => service.renderBackup(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.backup({ dir: ctx.dir, keep: ctx.keep });
  
  }
}
