// repo.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** repo.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  path: z.string(),
  name: z.string().optional(),
  icon: z.string().optional().describe("项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）"),
  desc: z.string().optional().describe("初始描述（写成项目主篇文档；之后描述以文档为准）"),
  notes: z.string().optional(),
  type: z.enum(["dev", "ref"]).optional().describe("dev=开发仓库（默认），ref=参考仓库"),
  remote: z.string().optional().describe("远程 git 地址（key 的来源；导出时导它）"),
  key: z.string().optional().describe("全局唯一 key（必填：有 remote 可省略并按 host/owner/repo 归一化；无 remote 时必须给）"),
  'key-custom': z.boolean().optional().describe("把 key 标记为自定义（显式给 --key 时默认就是自定义，不跟随 remote 变化）"),
});

export class RepoAddAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.add',
    cli: ['repo', 'add'],
    http: ['POST', '/api/repos'],
    summary: '登记一个仓库',
    args: ['path'],
    input,
    render: (r: any) => `已登记: ${r.name} -> ${r.path}（key: ${r.key}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addRepo({
        ...ctx,
        // 给了 --key 就视为自定义；否则用显式的 --key-custom（缺省 false = 跟随 remote）
        keyCustom: ctx.key ? true : ctx['key-custom'] === true,
      });
  
  }
}
