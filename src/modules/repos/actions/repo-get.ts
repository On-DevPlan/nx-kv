// repo.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderRepo as _renderRepo } from '../cli/render.js';
const service: any = serviceNs;
const renderRepo: any = _renderRepo;

/** repo.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class RepoGetAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.get',
    cli: ['repo', 'get'],
    http: ['GET', '/api/repos/:id'],
    summary: '查看单个仓库的登记信息',
    args: ['id'],
    input,
    render: renderRepo,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.getRepo(ctx.id);
  
  }
}
