// repo.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoAddInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class RepoAddAction extends ActionBase {
  @action({
    id: 'repo.add',
    cli: ['repo', 'add'],
    http: ['POST', '/api/repos'],
    summary: '登记一个仓库',
    args: ['path'],
    input: repoAddInput,
    render: (r: any) => `已登记: ${r.name} -> ${r.path}（key: ${r.key}）`,
  })
  async add(ctx: any) {

      return service.addRepo({
        ...ctx,
        // 给了 --key 就视为自定义；否则用显式的 --key-custom（缺省 false = 跟随 remote）
        keyCustom: ctx.key ? true : ctx['key-custom'] === true,
      });
  
  }
}
