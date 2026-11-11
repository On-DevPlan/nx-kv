// group.members —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { listGroupMembers as _listGroupMembers } from '../../../core/kvapi.js';
import { findGroup } from '../support.js';
const requireAuth: any = _requireAuth;
const listGroupMembers: any = _listGroupMembers;

/** group.members 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class GroupMembersAction extends ActionBase<typeof input> {
  @action({
    id: 'group.members',
    cli: ['group', 'members'],
    http: ['GET', '/api/groups/:id/members'],
    summary: '查看工作空间成员',
    args: ['id'],
    input,
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
