// 面板注册表 —— 工作区里能开的面板（component 名字 → React 组件）。
//
// 与 registry.js（视图注册表）的分工：那边是「有哪些视图」，这边是「工作区里
// 能开哪些面板」。面板是**一等公民**：可拖拽、可拆分、可拖出成浮窗、布局自动记住。
//
// FlexLayout 的 factory 只认 node.getComponent() 这个字符串，其余参数（config）
// 从 node.getConfig() 取。加一种面板 = 这里加一行。
import { Suspense, lazy } from 'react';
import { useApp } from './app-context.jsx';
import { docIdOf, peekDoc, scopeOf } from './modules/md/doc-store.js';
import SidebarPanel from './components/sidebar/panel.jsx';
import { openFloatingPanel } from './workspace.js';

const DirPanel = lazy(() => import('./page/dir/index.jsx'));
const PagePanel = lazy(() => import('./page/dir/task.jsx'));
const ProgressPanel = lazy(() => import('./page/progress/index.jsx'));
const GroupView = lazy(() => import('./page/group/index.jsx'));
const ReposView = lazy(() => import('./page/repos/index.jsx'));
const TodoView = lazy(() => import('./page/cloud/index.jsx'));
const OverviewView = lazy(() => import('./page/overview/index.jsx'));
const TemplatePanel = lazy(() => import('./page/templates/index.jsx'));
const DocPanel = lazy(() => import('./page/doc/index.jsx'));
const SettingsPanel = lazy(() => import('./page/settings/index.jsx'));
const DagPanel = lazy(() => import('./page/dag/index.jsx'));

/** 给懒加载的视图套上 Suspense（传的是**元素**，不是组件） */
const wrap = (el) => (
  <Suspense fallback={<div className="pad muted">加载中…</div>}>{el}</Suspense>
);

/** 空态：还没开任何面板时的落地页。讲清「下一步做什么」，不放装饰。 */
function WelcomePanel() {
  return (
    <div className="pad stack welcome">
      <div><strong>从左边目录选一个项目组或目录</strong>——选中的内容显示在中间主内容区。</div>
      <div className="hint">主内容区一次只放一块面板（顶部面包屑告诉你现在在哪）；设置这类临时面板以浮窗形式出现。</div>
      <div className="hint">目录在左、并发进程在右；两边都能收起或关掉，需要时再开。</div>
    </div>
  );
}

/** 目录工作台（子任务表） */
function DirPanelView({ dirKey }) {
  return wrap(<DirPanel dirKey={dirKey} />);
}

/** 一个 MD 页（编辑器）：页签在工作区里，内容在会话内存里；beside=旁路原文（可关） */
function PagePanelView({ dirKey, task, beside, tabId, model }) {
  return wrap(<PagePanel dirKey={dirKey} task={task} beside={!!beside} tabId={tabId} model={model} />);
}

/** 并发进程面板：独立成块，可拖到任意一边；task = 当前主区任务，用于高亮 */
function ProgressPanelView({ dirKey, task }) {
  const app = useApp() || {};
  return wrap(
    <ProgressPanel
      dirKey={dirKey}
      task={task}
      rows={app.rows}
      refreshLocal={app.refreshLocal}
      model={app.model}
      onOpenTask={(id) => app.openPage && app.openPage({ dirKey, task: String(id), name: `#${id}` })}
      onClosePage={(tabId) => app.closePanel && app.closePanel(tabId)}
    />
  );
}

/** 项目组：组里的子目录表（model 要透下去——双链点击要在工作区开文档页签） */
function GroupPanel({ boardId, model }) {
  const app = useApp() || {};
  return wrap(
    <GroupView
      dirKey={boardId}
      rows={app.rows}
      repoData={app.repoData}
      onNavigate={app.onNavigate}
      refreshLocal={app.refreshLocal}
      model={model || app.model}
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
    <PagePanelView
      dirKey={cfg && cfg.dirKey}
      task={cfg && cfg.task}
      beside={cfg && cfg.beside}
      tabId={ctx && ctx.tabId}
      model={ctx && ctx.model}
    />
  ) },
  progress: { title: '进程', render: (cfg) => <ProgressPanelView dirKey={cfg && cfg.dirKey} task={cfg && cfg.task} /> },
  group: { title: '项目组', render: (cfg, ctx) => <GroupPanel boardId={cfg && cfg.boardId} model={ctx && ctx.model} /> },
  repos: { title: '仓库管理', render: () => wrap(<ReposView />) },
  cloud: { title: '云端总览', render: () => wrap(<TodoView />) },
  overview: { title: '全部目录总览', render: () => <OverviewPanel /> },
  // 任务模板：单例面板（config 恒空，openPanel 会复用已有页签）
  templates: { title: '任务模板', render: () => wrap(<TemplatePanel />) },
  // 文档：config.docId 寻址（可 JSON 序列化 → openPanel 按 config 去重复用页签）
  doc: {
    title: '文档',
    render: (cfg, ctx) => wrap(
      <DocPanel
        docId={cfg && cfg.docId}
        repoKey={cfg && cfg.repoKey}
        boardKey={cfg && cfg.boardKey}
        boardName={cfg && cfg.boardName}
        tabId={ctx && ctx.tabId}
        model={ctx && ctx.model}
      />
    ),
  },
  // 设置：浮动面板（临时开一块、看完就关）——齿轮按钮走 openFloatingPanel
  settings: { title: '设置', render: () => wrap(<SettingsPanel />) },
  // 编排：可视化 DAG 面板（目录与项目组共用；按 config.dirKey 定位一个队列）
  dag: { title: '编排', render: (cfg) => wrap(<DagPanel dirKey={cfg && cfg.dirKey} />) },
};

/**
 * 开设置面板（浮动）。单独一个入口：齿轮按钮、窄轨齿轮、未来的快捷键都走它，
 * 「设置以浮动形态出现」这件事只在这里定义一次。
 */
export function openSettingsPanel(model) {
  if (!model) return null;
  return openFloatingPanel(model, { component: 'settings', name: '设置', config: {} });
}

/** 面板类型清单（总览页/文档里的固定顺序；旧「＋面板抽屉」已删，面板打开走侧栏树与路由） */
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
      // 旁路原文（评论任务右侧）不改地址——否则路由 effect 会按原文重开主区，冲掉评论页
      if (cfg.beside) return null;
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
