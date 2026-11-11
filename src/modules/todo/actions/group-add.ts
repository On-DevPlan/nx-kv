// group.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { groupAddInput } from '../schemas.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { createGroup as _createGroup } from '../../../core/kvapi.js';
const requireAuth: any = _requireAuth;
const createGroup: any = _createGroup;

export class GroupAddAction extends ActionBase<typeof groupAddInput> {
  @action({
    id: 'group.add',
    cli: ['group', 'add'],
    http: ['POST', '/api/groups'],
    summary: '新建工作空间',
    args: ['name'],
    input: groupAddInput,
    render: (g: any) => `已新建工作空间: ${g.name}（id=${g.id}）\n用 nx-kv group use ${g.id} 切过去`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        return createGroup({ name: ctx.name, description: ctx.description });
    
  }
}
