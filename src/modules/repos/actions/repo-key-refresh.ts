// repo.key.refresh —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoKeyRefreshInput } from '../schemas.js';
import * as keysNs from '../keys.js';
const keys: any = keysNs;

export class RepoKeyRefreshAction extends ActionBase<typeof repoKeyRefreshInput> {
  @action({
    id: 'repo.key.refresh',
    cli: ['repo', 'key', 'refresh'],
    http: ['POST', '/api/repos/key/refresh'],
    summary: '刷新仓库 key：扫描 git remote（SSH 优先），提示可更新的 key/远程地址；--apply 落盘',
    args: ['id'],
    input: repoKeyRefreshInput,
    render: (d: any) => keys.renderRefresh(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return keys.refreshKeys({ id: ctx.id, all: ctx.all === true, apply: ctx.apply === true });
  
  }
}
