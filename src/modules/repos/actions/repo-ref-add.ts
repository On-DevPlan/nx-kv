// repo.ref.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRefAddInput } from '../schemas.js';
import * as refNs from '../ref.js';
const ref: any = refNs;

export class RepoRefAddAction extends ActionBase<typeof repoRefAddInput> {
  @action({
    id: 'repo.ref.add',
    cli: ['repo', 'ref', 'add'],
    http: ['POST', '/api/repos/ref/add'],
    summary: '把一个已存在的 checkout 登记为参考仓库（不 clone；remote 缺省读 origin）',
    args: ['path'],
    input: repoRefAddInput,
    render: (r: any) => `已登记参考仓库: ${r.name} -> ${r.path}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return ref.registerRef(ctx);
  
  }
}
