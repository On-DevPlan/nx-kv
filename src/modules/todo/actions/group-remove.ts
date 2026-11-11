// group.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { loadConfig as _loadConfig, requireAuth as _requireAuth } from '../../../core/config.js';
import { deleteGroup as _deleteGroup } from '../../../core/kvapi.js';
import { badInput as _badInput } from '../../../core/errors.js';
import { findGroup } from '../support.js';
const loadConfig: any = _loadConfig;
const requireAuth: any = _requireAuth;
const deleteGroup: any = _deleteGroup;
const badInput: any = _badInput;

/** group.remove 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class GroupRemoveAction extends ActionBase<typeof input> {
  @action({
    id: 'group.remove',
    cli: ['group', 'remove'],
    http: ['DELETE', '/api/groups/:id'],
    summary: '解散工作空间（后端要求组内已无 KV）',
    args: ['id'],
    input,
    render: (d: any) => `已解散工作空间: ${d.name}（id=${d.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const g: any = await findGroup(ctx.id);
        const cfg: any = await loadConfig();
        if (g.id === cfg.groupId) {
          // 解散当前空间会导致后续所有读写打到一个不存在的组上，先拦住
          throw badInput(`不能解散当前正在使用的工作空间（${g.name}），先 nx-kv group use default 切走`);
        }
        await deleteGroup(g.id);
        return { id: g.id, name: g.name };
    
  }
}
