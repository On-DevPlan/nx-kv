// repo.clone —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoCloneInput } from '../schemas.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

export class RepoCloneAction extends ActionBase<typeof repoCloneInput> {
  @action({
    id: 'repo.clone',
    cli: ['repo', 'clone'],
    http: ['POST', '/api/repos/clone'],
    summary: '按 remote 克隆并登记（--key 指定占位 key → 组里位置自动补齐）',
    args: ['remote'],
    input: repoCloneInput,
    render: (d: any) => `已克隆并登记: ${d.name}（key ${d.key}）→ ${d.path}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.cloneRepo(ctx);
  
  }
}
