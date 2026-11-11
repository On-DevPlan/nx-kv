// 路由 ↔ 面板的纯映射（面板是「看得见的东西」，hash 是「能分享的地址」）。
//
// 与 panels 的分工：那边管「工作区里能开哪些面板」（要引
// React 与各视图组件），这边只管两种身份的互译——**纯函数、不引 React**，
// 单测直接 import（node --test 解析不了 JSX）。
//
//   路由变化 → 打开/聚焦对应面板；选中面板变化 → 地址跟着走（replaceState，不触发 hashchange）。
//   深链因此永远能复现同一屏：地址决定开哪块面板。
//
// 恒等式（任务 #86 踩过）：panelSpecOfRoute 生成的 config 必须能从 routeOfPanel
// 写回的路由**逐字**复现——openPanel 按 component+config 去重，任何一边多一个
// 字段都会裂出重复页签。
import type { TabNode } from 'flexlayout-react';
import { docIdOf, peekDoc, scopeOf } from './modules/md/doc-store.js';
import type { AppRoute, PanelConfig, PanelSpec, SpecCtx } from './types.js';

/** 全局池路由的固定 key（#/global → key=__GLOBAL__） */
export const GLOBAL_KEY = '__GLOBAL__';

// 文档 docId（`rel:…` / `path:…`）与地址段的互转。两条硬约束：
//   ① docId 带前缀冒号，整串编码会把 `:` 变成 %3A、与 panelSpecOfRoute 回填的
//      config 对不上 → 裂面板。**冒号后的路径段才编码**，前缀原样保留。
//   ② 返回值是"已编码"的查询串片段——交给 URLSearchParams 会**二次编码**
//      （`/` → `%2F` → `%252F`）。所以两个方向都在本函数内完成
//      encode/decodeURIComponent，调用方只做字符串拼接，绕开 URLSearchParams。
export function encodeDocRef(docId: unknown): string {
  const s = String(docId || '');
  const i = s.indexOf(':');
  if (i < 0) return encodeURIComponent(s);
  return s.slice(0, i) + ':' + encodeURIComponent(s.slice(i + 1));
}

export function decodeDocRef(v: unknown): string {
  const s = String(v || '');
  const i = s.indexOf(':');
  if (i < 0) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  try {
    return s.slice(0, i) + ':' + decodeURIComponent(s.slice(i + 1));
  } catch {
    return s;
  }
}

/** 面板默认标题：docId 去掉前缀、取路径末段、去掉 `.md` */
function docLabelOf(docId: unknown): string {
  const s = String(docId || '').replace(/^(rel|path):/, '');
  const seg = s.split(/[\\/]/).filter(Boolean).pop() || '';
  return seg.replace(/\.md$/i, '') || '文档';
}

/** 面板 → 路由（选中的面板变了，地址跟着变） */
export function routeOfPanel(node: TabNode | null | undefined): string | null {
  if (!node) return null;
  // 面板 config 是 FlexLayout 节点里的 JSON（形状按 component 而变）：外部边界，按索引放行
  const cfg: Record<string, any> = node.getConfig() || {};
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
    case 'templates': {
      // #137：编辑/新建必须把 mode 写进地址，否则选中回调把 hash 压成 #/templates，
      // 路由 effect 用空 config 重开 → 落到「模板目录」空页，冲掉全屏编辑器。
      const mode = String(cfg.mode || '');
      if (mode === 'edit' && cfg.id) {
        return `#/templates/edit/${encodeURIComponent(cfg.id)}`;
      }
      if (mode === 'new') {
        const parts: string[] = [];
        if (cfg.topic) parts.push(`topic=${encodeURIComponent(cfg.topic)}`);
        if (Array.isArray(cfg.scope) && cfg.scope.length) {
          parts.push(`scope=${encodeURIComponent(cfg.scope.join(','))}`);
        }
        return parts.length ? `#/templates/new?${parts.join('&')}` : '#/templates/new';
      }
      return '#/templates';
    }
    case 'doc': {
      // 文档页（#88）：点文档列表的一行进来，地址要能复现同一篇。
      // 归属（repo / board）一起带上——DocPanel 靠它决定「更多 → 文字列表」列谁的文章。
      if (!cfg.docId) return null;
      // 手拼查询串（不走 URLSearchParams）：encodeDocRef 已自行编码，
      // 交给 URLSearchParams 会二次编码成 %252F，与 panelSpecOfRoute 就对不上了。
      const parts = [`ref=${encodeDocRef(cfg.docId)}`];
      if (cfg.repoKey) parts.push(`repo=${encodeURIComponent(cfg.repoKey)}`);
      else if (cfg.boardKey) {
        parts.push(`board=${encodeURIComponent(cfg.boardKey)}`);
        if (cfg.boardName) parts.push(`name=${encodeURIComponent(cfg.boardName)}`);
      }
      return `#/doc?${parts.join('&')}`;
    }
    default:
      return null; // 侧栏 / 开始页 / 进程面板不是路由目标
  }
}

/** 草稿页签名：路由只认 draft-N，用 doc-store 里的草稿标题（读一次，不引响应性） */
function draftTitleOf(route: AppRoute): string {
  const task = String((route && route.task) || '');
  if (!task.startsWith('draft')) return '';
  const doc = peekDoc(docIdOf(scopeOf(route.key), task));
  return String((doc && doc.title) || '').trim();
}

/** 路由 → 面板规格（路由变了，打开/聚焦对应面板） */
export function panelSpecOfRoute(route: AppRoute | null | undefined, ctx: SpecCtx = {}): PanelSpec | null {
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
    case 'templates': {
      if (route.mode === 'edit' && route.id) {
        return {
          component: 'templates',
          name: '编辑模板',
          config: { mode: 'edit', id: String(route.id), name: '', topic: '', scope: [] },
        };
      }
      if (route.mode === 'new') {
        const scope = String(route.scope || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        return {
          component: 'templates',
          name: '新建模板',
          config: {
            mode: 'new',
            id: '',
            name: '',
            topic: String(route.topic || ''),
            scope,
          },
        };
      }
      return { component: 'templates', name: '任务模板', config: {} };
    }
    case 'doc': {
      // 必须与 routeOfPanel 的 doc 分支**逐字**互逆：config 少一个字段就裂面板
      // （openPanel 按 component+config 去重）。归属字段只在有值时出现。
      if (!route.key) return null;
      const cfg: PanelConfig = { docId: route.key };
      if (route.repoKey) cfg.repoKey = route.repoKey;
      else if (route.boardKey) {
        cfg.boardKey = route.boardKey;
        cfg.boardName = route.boardName || '';
      }
      return {
        component: 'doc',
        name: ctx.docTitle || ctx.pageTitle || docLabelOf(route.key),
        config: cfg,
      };
    }
    default:
      return null;
  }
}
