// repo.key.migrate —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as keysNs from '../keys.js';
const keys: any = keysNs;

/** repo.key.migrate 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  apply: z.boolean().optional().describe("写回磁盘（缺省只预览）"),
});

export class RepoKeyMigrateAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.key.migrate',
    cli: ['repo', 'key', 'migrate'],
    http: ['POST', '/api/repos/key/migrate'],
    summary: '把内部关系（看板成员/绑定）从随机 id 改写成 key（幂等；--apply 落盘）',
    input,
    render: (d: any) => keys.renderMigrate(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return keys.migrateRelations({ apply: ctx.apply === true });
  
  }
}
