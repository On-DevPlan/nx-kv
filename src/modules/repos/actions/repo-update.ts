// repo.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** repo.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  path: z.string().optional(),
  name: z.string().optional(),
  icon: z.string().optional().describe("项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）"),
  desc: z.string().optional().describe("（已废弃）描述是文档：改正文用 docs set，换绑用 docs bind —— 传了会报错"),
  notes: z.string().optional(),
  type: z.enum(["dev", "ref"]).optional().describe("dev=开发仓库，ref=参考仓库"),
  remote: z.string().optional().describe("远程 git 地址"),
  key: z.string().optional().describe("自定义 key（给了就视为 keyCustom）"),
  'key-custom': z.boolean().optional().describe("key 是否自定义（true=不跟随 remote）"),
  'get-loop': z.enum(["on", "off"]).optional().describe("持续 get 开关"),
  'get-loop-minutes': z.number().optional().describe("无任务时的阻塞窗口（分钟，默认 10，上限 600s 夹制）"),
  'get-loop-template': z.string().optional().describe("领到任务时追加的「继续 get」模板——整体替换为这一条（多条在设置面板按条增删；占位符 {{task.id}}/{{task.text}} 等；置空 = 用默认模板）"),
});

export class RepoUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.update',
    cli: ['repo', 'update'],
    http: ['PATCH', '/api/repos/:id'],
    summary: '修改仓库路径 / 名称 / 备注 / 类型 / 远程地址 / key；--get-loop* 配置项目级「持续 get」（waitgoal：该项目 get 无任务时阻塞等人回填 + 交付文本带继续 get 模板）。描述已改为文档，不再经这里改',
    args: ['id'],
    input,
    render: (r: any) => `已更新: ${r.name}（key: ${r.key}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

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
