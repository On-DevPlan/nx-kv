// repo.key.refresh —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as keysNs from '../keys.js';
const keys: any = keysNs;

/** repo.key.refresh 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string().optional(),
  all: z.boolean().optional().describe("刷新全部仓库"),
  apply: z.boolean().optional().describe("把建议写回（自定义 key 只更新 remote，不覆盖 key）"),
});

export class RepoKeyRefreshAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.key.refresh',
    cli: ['repo', 'key', 'refresh'],
    http: ['POST', '/api/repos/key/refresh'],
    summary: '刷新仓库 key：扫描 git remote（SSH 优先），提示可更新的 key/远程地址；--apply 落盘',
    args: ['id'],
    input,
    render: (d: any) => keys.renderRefresh(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return keys.refreshKeys({ id: ctx.id, all: ctx.all === true, apply: ctx.apply === true });
  
  }
}
