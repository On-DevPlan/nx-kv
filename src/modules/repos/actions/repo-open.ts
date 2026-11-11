// repo.open —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoOpenInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class RepoOpenAction extends ActionBase<typeof repoOpenInput> {
  @action({
    id: 'repo.open',
    cli: ['repo', 'open'],
    http: ['POST', '/api/repos/open'],
    summary: '在系统文件管理器中打开',
    args: ['id'],
    input: repoOpenInput,
    render: (d: any) => `已打开: ${d.opened}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.repoOpen(ctx.id);
  
  }
}
