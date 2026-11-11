// repo.clone —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as remoteNs from '../remote.js';
const remote: any = remoteNs;

/** repo.clone 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  remote: z.string(),
  key: z.string().optional().describe("登记时用的 key（补占位时填它）"),
  name: z.string().optional(),
  desc: z.string().optional(),
  type: z.enum(["dev", "ref"]).default('dev').describe("dev 落 gitDevRoot，ref 落 gitRepoRoot"),
  depth: z.number().default(1).describe("浅克隆深度"),
});

export class RepoCloneAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.clone',
    cli: ['repo', 'clone'],
    http: ['POST', '/api/repos/clone'],
    summary: '按 remote 克隆并登记（--key 指定占位 key → 组里位置自动补齐）',
    args: ['remote'],
    input,
    render: (d: any) => `已克隆并登记: ${d.name}（key ${d.key}）→ ${d.path}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return remote.cloneRepo(ctx);
  
  }
}
