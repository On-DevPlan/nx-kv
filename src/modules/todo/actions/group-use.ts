// group.use —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { updateConfig as _updateConfig, requireAuth as _requireAuth } from '../../../core/config.js';
import { findGroup } from '../support.js';
const updateConfig: any = _updateConfig;
const requireAuth: any = _requireAuth;

/** group.use 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  locator: z.string(),
});

export class GroupUseAction extends ActionBase<typeof input> {
  @action({
    id: 'group.use',
    cli: [['group', 'use'], ['group', 'switch']],
    http: ['POST', '/api/group'],
    summary: '切换当前工作空间（id 或名称；0 / default 回默认组）',
    args: ['locator'],
    input,
    render: (d: any) =>
      d.id === 0
        ? '已切回默认组（后续读写不传 groupId）'
        : `已切换到工作空间: ${d.name}（id=${d.id}）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        await requireAuth();
        const s: any = String(ctx.locator ?? '').trim();
        if (s === '0' || s.toLowerCase() === 'default') {
          await updateConfig({ groupId: 0 });
          return { id: 0, name: '默认组' };
        }
        const g: any = await findGroup(s);
        await updateConfig({ groupId: g.id });
        return g;
    
  }
}
