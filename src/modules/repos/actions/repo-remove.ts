// repo.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class RepoRemoveAction extends ActionBase {
  @action({
    id: 'repo.remove',
    cli: ['repo', 'remove'],
    http: ['DELETE', '/api/repos/:id'],
    summary: '移除登记（不动磁盘文件）',
    args: ['id'],
    input: repoRemoveInput,
    render: (r: any) => `已移除登记: ${r.name}（磁盘文件未动）`,
  })
  async remove(ctx: any) {

      return service.removeRepo(ctx.id);
  
  }
}
