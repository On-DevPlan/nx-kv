// 面板注册表 —— 工作区里能开的面板（component 名字 → React 组件）。
//
// 与 registry.js（视图注册表）的分工：那边是「有哪些视图」，这边是「工作区里
// 能开哪些面板」。面板是**一等公民**：可拖拽、可拆分、可拖出成浮窗、布局自动记住。
//
// FlexLayout 的 factory 只认 node.getComponent() 这个字符串，其余参数（config）
// 从 node.getConfig() 取。加一种面板 = 这里加一行。
import { Suspense, lazy } from 'react';
import { useApp } from './app-context.jsx';
import SidebarPanel from './components/sidebar/panel.jsx';

const DirPanel = lazy(() => import('./modules/md-workspace/view.jsx'));
const PagePanel = lazy(() => import('./modules/md-workspace/page-panel.jsx'));
const ProgressPanel = lazy(() => import('./modules/md-workspace/progress-panel.jsx'));
const GroupView = lazy(() => import('../../modules/repos/group-view.jsx'));
const ReposView = lazy(() => import('../../modules/repos/view.jsx'));
const TodoView = lazy(() => import('../../modules/todo/view.jsx'));
const OverviewView = lazy(() => import('../../modules/localtask/view-overview.jsx'));
const TemplatePanel = lazy(() => import('./modules/md-workspace/template-panel.jsx'));

/** 给懒加载的视图套上 Suspense（传的是**元素**，不是组件） */
const wrap = (el) => (
  <Suspense fallback={<div className="pad muted">加载中…</div>}>{el}</Suspense>
);

/** 空态：还没开任何面板时的落地页。讲清「下一步做什么」，不放装饰。 */
function WelcomePanel() {
  return (
    <div className="pad stack welcome">
      <div><strong>从左边目录选一个项目组或目录</strong>，或用右上角「＋ 面板」开一块。</div>
      <div className="hint">面板可以拖到任意一边拆分，也可以拖出成浮窗；布局会自动记住。</div>
      <div className="hint">目录本身也是一块面板 —— 它能被拖走、拖到右边、拖成浮窗。</div>
    </div>
  );
}

/** 目录工作台（子任务表） */
function DirPanelView({ dirKey }) {
  return wrap(<DirPanel dirKey={dirKey} />);
}

/** 一个 MD 页（编辑器）：页签在工作区里，内容在会话内存里 */
function PagePanelView({ dirKey, task, tabId, model }) {
  return wrap(<PagePanel dirKey={dirKey} task={task} tabId={tabId} model={model} />);
}

/** 并发进程面板：独立成块，可拖到任意一边 */
function ProgressPanelView({ dirKey }) {
  const app = useApp() || {};
  return wrap(
    <ProgressPanel
      dirKey={dirKey}
      rows={app.rows}
      refreshLocal={app.refreshLocal}
      model={app.model}
      onOpenTask={(id) => app.openPage && app.openPage({ dirKey, task: String(id), name: `#${id}` })}
      onClosePage={(tabId) => app.closePanel && app.closePanel(tabId)}
    />
  );
}

/** 项目组：组里的子目录表 */
function GroupPanel({ boardId }) {
  const app = useApp() || {};
  return wrap(
    <GroupView
      dirKey={boardId}
      rows={app.rows}
      repoData={app.repoData}
      onNavigate={app.onNavigate}
      refreshLocal={app.refreshLocal}
    />
  );
}

function OverviewPanel() {
  const app = useApp() || {};
  return wrap(<OverviewView rows={app.rows} onNavigate={app.onNavigate} refreshLocal={app.refreshLocal} />);
}

export const PANELS = {
  sidebar: { title: '目录', render: () => <SidebarPanel /> },
  welcome: { title: '开始', render: () => <WelcomePanel /> },
  dir: { title: '目录', render: (cfg) => <DirPanelView dirKey={cfg && cfg.dirKey} /> },
  page: { title: '页面', render: (cfg, ctx) => (
    <PagePanelView dirKey={cfg && cfg.dirKey} task={cfg && cfg.task} tabId={ctx && ctx.tabId} model={ctx && ctx.model} />
  ) },
  progress: { title: '进程', render: (cfg) => <ProgressPanelView dirKey={cfg && cfg.dirKey} /> },
  group: { title: '项目组', render: (cfg) => <GroupPanel boardId={cfg && cfg.boardId} /> },
  repos: { title: '仓库管理', render: () => wrap(<ReposView />) },
  cloud: { title: '云端总览', render: () => wrap(<TodoView />) },
  overview: { title: '全部目录总览', render: () => <OverviewPanel /> },
  // 任务模板：单例面板（config 恒空，openPanel 会复用已有页签）
  templates: { title: '任务模板', render: () => wrap(<TemplatePanel />) },
};

/** 抽屉里的顺序：先业务后工具 */
export const PANEL_ORDER = ['overview', 'group', 'repos', 'cloud', 'templates'];

/**
 * FlexLayout 的 factory：只认 component 字符串，参数从 config 取。
 * 额外把 model / tabId 传给面板——面板要改**自己**的 config 时需要它们。
 */
export function factory(node) {
  const p = PANELS[node.getComponent()];
  if (!p) {
    return <div className="muted" style={{ padding: 12 }}>未知面板：{node.getComponent()}</div>;
  }
  return p.render(node.getConfig() || {}, { tabId: node.getId(), model: node.getModel(), node });
}

// ─── 路由 ↔ 面板 ────────────────────────────────────────────────
//
// 面板是「看得见的东西」，hash 是「能分享的地址」——两者必须指向同一件事：
//   路由变化 → 打开/聚焦对应面板；选中面板变化 → 地址跟着走（replaceState，不触发 hashchange）。
// 深链因此永远能复现同一屏：地址决定开哪块面板。

export const GLOBAL_KEY = '__GLOBAL__';

/** 面板 → 路由（选中的面板变了，地址跟着变） */
export function routeOfPanel(node) {
  if (!node) return null;
  const cfg = node.getConfig() || {};
  switch (node.getComponent()) {
    case 'page':
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

/** 路由 → 面板规格（路由变了，打开/聚焦对应面板） */
export function panelSpecOfRoute(route, ctx = {}) {
  if (!route) return null;
  switch (route.view) {
    case 'dir':
      // 带 ?task= → 那是**某一页**（页签面板）；不带 → 目录的子任务表
      if (route.task) {
        return {
          component: 'page',
          name: ctx.pageTitle || `页 ${route.task}`,
          config: { dirKey: route.key, task: route.task },
        };
      }
      return {
        component: 'dir',
        name: ctx.dirName || '目录',
        config: { dirKey: route.key },
      };
    case 'group':
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
