// group.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { updateGroup as _updateGroup } from '../../../core/kvapi.js';
import { findGroup } from '../support.js';
const requireAuth: any = _requireAuth;
const updateGroup: any = _updateGroup;

/** group.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名称"),
  description: z.string().optional().describe("新描述"),
});

export class GroupUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'group.update',
    cli: ['group', 'update'],
    http: ['PATCH', '/api/groups/:id'],
    summary: '改名 / 改描述（只改传入的字段）',
    args: ['id'],
    input,
    render: (g: any) => `已更新工作空间: ${g.name}（id=${g.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const g: any = await findGroup(ctx.id); // 支持按名字定位，再拿真实 id
        return updateGroup(g.id, { name: ctx.name, description: ctx.description });
    
  }
}
