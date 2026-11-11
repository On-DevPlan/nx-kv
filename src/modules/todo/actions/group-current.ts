// group.current —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { loadConfig as _loadConfig } from '../../../core/config.js';
import { listGroups as _listGroups } from '../../../core/kvapi.js';
const loadConfig: any = _loadConfig;
const listGroups: any = _listGroups;

/** group.current 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class GroupCurrentAction extends ActionBase<typeof input> {
  @action({
    id: 'group.current',
    cli: ['group', 'current'],
    http: ['GET', '/api/group'],
    summary: '查看当前工作空间',
    input,
    render: (d: any) => `当前工作空间: ${d.name}（${d.id === 0 ? '默认组，不传 groupId' : 'id=' + d.id}）`,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

        const cfg: any = await loadConfig();
        if (!cfg.groupId) return { id: 0, name: '默认组' };
        // 名字是尽力而为：后端不可达时不该让「看当前是什么」失败
        const groups: any = await listGroups().catch(() => []);
        const hit: any = groups.find((g: any) => g.id === cfg.groupId);
        return { id: cfg.groupId, name: hit ? hit.name : `#${cfg.groupId}` };
    
  }
}
