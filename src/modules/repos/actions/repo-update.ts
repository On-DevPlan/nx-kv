// repo.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoUpdateInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class RepoUpdateAction extends ActionBase {
  @action({
    id: 'repo.update',
    cli: ['repo', 'update'],
    http: ['PATCH', '/api/repos/:id'],
    summary: '修改仓库路径 / 名称 / 备注 / 类型 / 远程地址 / key；--get-loop* 配置项目级「持续 get」（waitgoal：该项目 get 无任务时阻塞等人回填 + 交付文本带继续 get 模板）。描述已改为文档，不再经这里改',
    args: ['id'],
    input: repoUpdateInput,
    render: (r: any) => `已更新: ${r.name}（key: ${r.key}）`,
  })
  async update(ctx: any) {

        const patch: any = { ...ctx, keyCustom: ctx['key-custom'] === undefined ? undefined : ctx['key-custom'] === true };
        if (ctx['get-loop'] !== undefined || ctx['get-loop-minutes'] !== undefined || ctx['get-loop-template'] !== undefined) {
          patch.getLoop = {
            ...(ctx['get-loop'] !== undefined ? { enabled: ctx['get-loop'] === 'on' } : {}),
            ...(ctx['get-loop-minutes'] !== undefined ? { waitMinutes: ctx['get-loop-minutes'] } : {}),
            ...(ctx['get-loop-template'] !== undefined ? { template: ctx['get-loop-template'] } : {}),
          };
        }
        return service.updateRepo(ctx.id, patch);
    
  }
}
