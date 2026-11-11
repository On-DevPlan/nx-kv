// repo.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderRepoList as _renderRepoList } from '../cli/render.js';
const service: any = serviceNs;
const renderRepoList: any = _renderRepoList;

/** repo.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  type: z.enum(["dev", "ref"]).optional().describe("只看某类：dev=开发仓库，ref=参考仓库"),
});

export class RepoListAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.list',
    cli: ['repo', 'list'],
    http: ['GET', '/api/repos'],
    summary: '仓库清单（本地任务的主题会按路径匹配到这里，取它的上下文）',
    input,
    render: renderRepoList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listRepos().then((list: any) => (ctx.type ? list.filter((r: any) => (r.type || 'dev') === ctx.type) : list));
  
  }
}
