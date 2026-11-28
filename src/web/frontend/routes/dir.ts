// 目录视图（`#/dir/<dirKey>`）。
//
// 带 `?task=` → 那是**某一页**（页签面板）；不带 → 目录的子任务表。
// 反向上，`page` 这块面板被 dir 与 group 两个视图共用：谁更具体谁先试
// （group 的 order 比这里小），这里只处理「没有 groupId 的 page」。
import type { AppRoute, SpecCtx } from '../types.js';
import { definePage } from './types.js';

export const dirPage = definePage({
  view: 'dir',
  panelOf: (route: AppRoute, ctx: SpecCtx) => {
    // 带 ?task= → 那是**某一页**（页签面板）；不带 → 目录的子任务表
    if (route.task) {
      return {
        panel: { component: 'page', config: { dirKey: route.key, task: route.task } },
        name: ctx.pageTitle || `页 ${route.task}`,
      };
    }
    return {
      panel: { component: 'dir', config: { dirKey: route.key } },
      name: ctx.dirName || '目录',
    };
  },
  reverse: [
    {
      // 组锚定页比本视图更具体，先由 group.ts 认领；到这里说明 cfg 里没有 groupId
      component: 'page',
      order: 20,
      format: (cfg) => {
        if (cfg.groupId) return undefined;
        // 旁路原文（评论任务右侧）不改地址——否则路由 effect 会按原文重开主区，冲掉评论页
        if (cfg.beside) return null;
        return `#/dir/${encodeURIComponent(cfg.dirKey || '')}?task=${encodeURIComponent(cfg.task || '')}`;
      },
    },
    {
      component: 'dir',
      order: 10,
      format: (cfg) => `#/dir/${encodeURIComponent(cfg.dirKey || '')}`,
    },
  ],
});
