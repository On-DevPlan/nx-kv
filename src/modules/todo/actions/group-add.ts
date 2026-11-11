// group.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { createGroup as _createGroup } from '../../../core/kvapi.js';
const requireAuth: any = _requireAuth;
const createGroup: any = _createGroup;

/** group.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  name: z.string(),
  description: z.string().optional().describe("描述"),
});

export class GroupAddAction extends ActionBase<typeof input> {
  @action({
    id: 'group.add',
    cli: ['group', 'add'],
    http: ['POST', '/api/groups'],
    summary: '新建工作空间',
    args: ['name'],
    input,
    render: (g: any) => `已新建工作空间: ${g.name}（id=${g.id}）\n用 nx-kv group use ${g.id} 切过去`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        return createGroup({ name: ctx.name, description: ctx.description });
    
  }
}
