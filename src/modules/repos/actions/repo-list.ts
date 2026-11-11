// repo.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderRepoList as _renderRepoList } from '../cli/render.js';
const service: any = serviceNs;
const renderRepoList: any = _renderRepoList;

export class RepoListAction extends ActionBase<typeof repoListInput> {
  @action({
    id: 'repo.list',
    cli: ['repo', 'list'],
    http: ['GET', '/api/repos'],
    summary: '仓库清单（本地任务的主题会按路径匹配到这里，取它的上下文）',
    input: repoListInput,
    render: renderRepoList,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.listRepos().then((list: any) => (ctx.type ? list.filter((r: any) => (r.type || 'dev') === ctx.type) : list));
  
  }
}
