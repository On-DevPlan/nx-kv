// group.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { groupListInput } from '../schemas.js';
import { loadConfig as _loadConfig, requireAuth as _requireAuth } from '../../../core/config.js';
import { listGroups as _listGroups } from '../../../core/kvapi.js';
import { renderGroupLine } from '../support.js';
const loadConfig: any = _loadConfig;
const requireAuth: any = _requireAuth;
const listGroups: any = _listGroups;

export class GroupListAction extends ActionBase {
  @action({
    id: 'group.list',
    cli: ['group', 'list'],
    http: ['GET', '/api/groups'],
    summary: '列出我的工作空间（* 为当前）',
    input: groupListInput,
    render: (d: any) => {
      if (!d.groups.length) return '（没有可用工作空间）';
      return d.groups.map((g: any) => renderGroupLine(g, g.current)).join('\n');
    },
  })
  async list(_ctx: any) {

        await requireAuth();
        const [groups, cfg] = await Promise.all([listGroups(), loadConfig()]);
        return {
          current: cfg.groupId,
          groups: groups.map((g: any) => ({ ...g, current: g.id === cfg.groupId })),
        };
    
  }
}
