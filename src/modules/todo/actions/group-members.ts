// group.members —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { groupMembersInput } from '../schemas.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { listGroupMembers as _listGroupMembers } from '../../../core/kvapi.js';
import { findGroup } from '../support.js';
const requireAuth: any = _requireAuth;
const listGroupMembers: any = _listGroupMembers;

export class GroupMembersAction extends ActionBase<typeof groupMembersInput> {
  @action({
    id: 'group.members',
    cli: ['group', 'members'],
    http: ['GET', '/api/groups/:id/members'],
    summary: '查看工作空间成员',
    args: ['id'],
    input: groupMembersInput,
    render: (d: any) => {
      if (!d.members.length) return `${d.group.name}: （没有成员）`;
      const w: any = Math.max(...d.members.map((m: any) => m.email.length));
      return d.members
        .map((m: any) => `  ${m.email.padEnd(w)}  ${m.role.padEnd(8)}  ${m.nickname}`)
        .join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const g: any = await findGroup(ctx.id);
        return { group: { id: g.id, name: g.name }, members: await listGroupMembers(g.id) };
    
  }
}
