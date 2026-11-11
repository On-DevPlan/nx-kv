// group.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { groupGetInput } from '../schemas.js';
import { loadConfig as _loadConfig, requireAuth as _requireAuth } from '../../../core/config.js';
import { findGroup } from '../support.js';
const loadConfig: any = _loadConfig;
const requireAuth: any = _requireAuth;

export class GroupGetAction extends ActionBase<typeof groupGetInput> {
  @action({
    id: 'group.get',
    cli: ['group', 'get'],
    http: ['GET', '/api/groups/:id'],
    summary: '查看单个工作空间',
    args: ['id'],
    input: groupGetInput,
    render: (g: any) =>
      [
        `${g.name}${g.current ? '  ← 当前' : ''}`,
        `  id:     ${g.id}`,
        `  角色:   ${g.myRole || '-'}`,
        `  成员:   ${g.memberCount} 人`,
        `  描述:   ${g.description || '-'}`,
        `  创建:   ${String(g.createdAt || '').slice(0, 10) || '-'}`,
      ].join('\n'),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const g: any = await findGroup(ctx.id);
        const cfg: any = await loadConfig();
        return { ...g, current: g.id === cfg.groupId };
    
  }
}
