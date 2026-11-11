// group.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { groupUpdateInput } from '../schemas.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { updateGroup as _updateGroup } from '../../../core/kvapi.js';
import { findGroup } from '../support.js';
const requireAuth: any = _requireAuth;
const updateGroup: any = _updateGroup;

export class GroupUpdateAction extends ActionBase<typeof groupUpdateInput> {
  @action({
    id: 'group.update',
    cli: ['group', 'update'],
    http: ['PATCH', '/api/groups/:id'],
    summary: '改名 / 改描述（只改传入的字段）',
    args: ['id'],
    input: groupUpdateInput,
    render: (g: any) => `已更新工作空间: ${g.name}（id=${g.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const g: any = await findGroup(ctx.id); // 支持按名字定位，再拿真实 id
        return updateGroup(g.id, { name: ctx.name, description: ctx.description });
    
  }
}
