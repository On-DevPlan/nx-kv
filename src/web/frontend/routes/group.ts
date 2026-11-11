// 项目组视图（`#/group/<boardId>`）。
//
// 带 `?task=` → 组内某一页（组锚定页签；成员队列在 PagePanel 内部解析，#86）。
// 反向上 group 的 `page` 映射比 dir 更具体（order 更小），必须先试：
// 组锚定页有自己的地址 `#/group/<boardId>?task=N`，落到 `#/dir/…` 就会开后端不存在的队列。
import type { AppRoute, SpecCtx } from '../types.js';
import { definePage } from './types.js';

export const groupPage = definePage({
  view: 'group',
  panelOf: (route: AppRoute, ctx: SpecCtx) => {
    if (route.task) {
      return {
        panel: { component: 'page', config: { groupId: route.key, task: route.task } },
        name: ctx.pageTitle || `页 ${route.task}`,
      };
    }
    return {
      panel: { component: 'group', config: { boardId: route.key } },
      name: ctx.boardName || '项目组',
    };
  },
  reverse: [
    {
      component: 'page',
      order: 5,
      format: (cfg) => (cfg.groupId
        ? `#/group/${encodeURIComponent(cfg.groupId)}?task=${encodeURIComponent(cfg.task || '')}`
        : undefined),
    },
    {
      component: 'group',
      order: 0,
      format: (cfg) => `#/group/${encodeURIComponent(cfg.boardId || '')}`,
    },
  ],
});
