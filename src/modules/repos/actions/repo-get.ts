// repo.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderRepo as _renderRepo } from '../cli/render.js';
const service: any = serviceNs;
const renderRepo: any = _renderRepo;

export class RepoGetAction extends ActionBase {
  @action({
    id: 'repo.get',
    cli: ['repo', 'get'],
    http: ['GET', '/api/repos/:id'],
    summary: '查看单个仓库的登记信息',
    args: ['id'],
    input: repoGetInput,
    render: renderRepo,
  })
  async get(ctx: any) {

      return service.getRepo(ctx.id);
  
  }
}
