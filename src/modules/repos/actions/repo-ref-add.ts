// repo.ref.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refNs from '../ref.js';
const ref: any = refNs;

/** repo.ref.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  path: z.string(),
  remote: z.string().optional().describe("远程地址（目录没有 origin 时必给）"),
  name: z.string().optional(),
  desc: z.string().optional(),
  notes: z.string().optional(),
});

export class RepoRefAddAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.add',
    cli: ['repo', 'ref', 'add'],
    http: ['POST', '/api/repos/ref/add'],
    summary: '把一个已存在的 checkout 登记为参考仓库（不 clone；remote 缺省读 origin）',
    args: ['path'],
    input,
    render: (r: any) => `已登记参考仓库: ${r.name} -> ${r.path}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return ref.registerRef(ctx);
  
  }
}
