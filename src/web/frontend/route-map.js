// 路由 ↔ 面板的纯映射（面板是「看得见的东西」，hash 是「能分享的地址」）。
//
// 与 panels.jsx（面板注册表）的分工：那边管「工作区里能开哪些面板」（要引
// React 与各视图组件），这边只管两种身份的互译——**纯函数、不引 React**，
// 单测直接 import（node --test 解析不了 JSX）。
//
//   路由变化 → 打开/聚焦对应面板；选中面板变化 → 地址跟着走（replaceState，不触发 hashchange）。
//   深链因此永远能复现同一屏：地址决定开哪块面板。
//
// 恒等式（任务 #86 踩过）：panelSpecOfRoute 生成的 config 必须能从 routeOfPanel
// 写回的路由**逐字**复现——openPanel 按 component+config 去重，任何一边多一个
// 字段都会裂出重复页签。
import { docIdOf, peekDoc, scopeOf } from './modules/md/doc-store.js';

/** 全局池路由的固定 key（#/global → key=__GLOBAL__） */
export const GLOBAL_KEY = '__GLOBAL__';

/** 面板 → 路由（选中的面板变了，地址跟着变） */
export function routeOfPanel(node) {
  if (!node) return null;
  const cfg = node.getConfig() || {};
  switch (node.getComponent()) {
    case 'page':
      // 旁路原文（评论任务右侧）不改地址——否则路由 effect 会按原文重开主区，冲掉评论页
      if (cfg.beside) return null;
      // 组锚定页（#86）：组任务详情有自己的路由 —— #/group/<boardId>?task=N。
      // 成员队列只在面板内部解析（config 必须能从这条路由逐字复现，去重才不裂）。
      if (cfg.groupId) {
        return `#/group/${encodeURIComponent(cfg.groupId)}?task=${encodeURIComponent(cfg.task || '')}`;
      }
      return `#/dir/${encodeURIComponent(cfg.dirKey || '')}?task=${encodeURIComponent(cfg.task || '')}`;
    case 'dir':
      return cfg.dirKey === GLOBAL_KEY
        ? '#/global'
        : `#/dir/${encodeURIComponent(cfg.dirKey || '')}`;
    case 'group':
      return `#/group/${encodeURIComponent(cfg.boardId || '')}`;
    case 'repos':
      return '#/repos';
    case 'cloud':
      return '#/cloud';
    case 'overview':
      return '#/overview';
    case 'templates':
      return '#/templates';
    default:
      return null; // 侧栏 / 开始页 / 进程面板不是路由目标
  }
}

/** 草稿页签名：路由只认 draft-N，用 doc-store 里的草稿标题（读一次，不引响应性） */
function draftTitleOf(route) {
  const task = String((route && route.task) || '');
  if (!task.startsWith('draft')) return '';
  const doc = peekDoc(docIdOf(scopeOf(route.key), task));
  return String((doc && doc.title) || '').trim();
}

/** 路由 → 面板规格（路由变了，打开/聚焦对应面板） */
export function panelSpecOfRoute(route, ctx = {}) {
  if (!route) return null;
  switch (route.view) {
    case 'dir':
      // 带 ?task= → 那是**某一页**（页签面板）；不带 → 目录的子任务表
      if (route.task) {
        return {
          component: 'page',
          name: ctx.pageTitle || draftTitleOf(route) || `页 ${route.task}`,
          config: { dirKey: route.key, task: route.task },
        };
      }
      return {
        component: 'dir',
        name: ctx.dirName || '目录',
        config: { dirKey: route.key },
      };
    case 'group':
      // 带 ?task= → 组内某一页（组锚定页签；成员队列在 PagePanel 内部解析，#86）
      if (route.task) {
        return {
          component: 'page',
          name: ctx.pageTitle || `页 ${route.task}`,
          config: { groupId: route.key, task: route.task },
        };
      }
      return {
        component: 'group',
        name: ctx.boardName || '项目组',
        config: { boardId: route.key },
      };
    case 'repos':
      return { component: 'repos', name: '仓库管理', config: {} };
    case 'cloud':
      return { component: 'cloud', name: '云端总览', config: {} };
    case 'overview':
      return { component: 'overview', name: '全部目录总览', config: {} };
    case 'templates':
      return { component: 'templates', name: '任务模板', config: {} };
    default:
      return null;
  }
}
