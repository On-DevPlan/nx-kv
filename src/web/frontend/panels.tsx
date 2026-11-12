// 面板注册表 —— 工作区里能开的面板（component 名字 → React 组件）。
//
// 与 registry.js（视图注册表）的分工：那边是「有哪些视图」，这边是「工作区里
// 能开哪些面板」。面板是**一等公民**：可拖拽、可拆分、可拖出成浮窗、布局自动记住。
//
// FlexLayout 的 factory 只认 node.getComponent() 这个字符串，其余参数（config）
// 从 node.getConfig() 取。加一种面板 = 这里加一行。
import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import type { Model, TabNode } from 'flexlayout-react';
import { useApp } from './app-context.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import SidebarPanel from './components/sidebar/panel.jsx';
import { openFloatingPanel, openPanel } from './workspace.js';
import type { PanelConfig, PanelCtx, TemplateEditorOpts } from './types.js';

const DirPanel = lazy(() => import('./page/dir/index.jsx'));
const PagePanel = lazy(() => import('./page/dir/task.jsx'));
const ProgressPanel = lazy(() => import('./page/progress/index.jsx'));
const RefsPanel = lazy(() => import('./page/refs/index.jsx'));
const GroupView = lazy(() => import('./page/group/index.jsx'));
const ReposView = lazy(() => import('./page/repos/index.jsx'));
const TodoView = lazy(() => import('./page/cloud/index.jsx'));
const OverviewView = lazy(() => import('./page/overview/index.jsx'));
const TemplatePanel = lazy(() => import('./page/templates/index.jsx'));
const DocPanel = lazy(() => import('./page/doc/index.jsx'));
const SettingsPanel = lazy(() => import('./page/settings/index.jsx'));
const DagPanel = lazy(() => import('./page/dag/index.jsx'));
const ComposePanel = lazy(() => import('./components/md/composer-panel.jsx'));

/** 给懒加载的视图套上 Suspense（传的是**元素**，不是组件） */
const wrap = (el: ReactNode) => (
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
function DirPanelView({ dirKey }: { dirKey?: string }) {
  return wrap(<DirPanel dirKey={dirKey} />);
}

/** 一个 MD 页（编辑器）：页签在工作区里，内容在会话内存里；beside=旁路原文（可关）；historyId=链节点只读
 *  groupId（任务 #86）= 组锚定页：组任务详情路由 #/group/<boardId>?task=N，成员队列在面板内部解析 */
interface PagePanelViewProps {
  dirKey?: string;
  groupId?: string;
  /** 来自面板 config（外部边界）：缺省时这里是 `any` 的 undefined，与旧 JS 行为一致。 */
  task: string;
  beside?: boolean;
  tabId?: string;
  model?: Model | null;
  historyId?: string | number | null;
}

function PagePanelView({ dirKey, groupId, task, beside, tabId, model, historyId }: PagePanelViewProps) {
  return wrap(
    <PagePanel
      dirKey={dirKey}
      groupId={groupId}
      task={task}
      beside={!!beside}
      tabId={tabId}
      model={model}
      historyId={historyId != null ? Number(historyId) : null}
    />,
  );
}

/** 并发进程面板：独立成块，可拖到任意一边；task = 当前主区任务，用于高亮。
 *  groupKey（任务 #56）= 项目组（board）id：进程按**组**聚合组内各项目队列的任务，
 *  卡片带项目 tag 并可按项目筛选；不传 = 目录/全局模式（现状）。 */
function ProgressPanelView({ dirKey, task, groupKey }: { dirKey?: string; task?: string; groupKey?: string }) {
  const app = useApp();
  const board = groupKey
    ? ((app.repoData && app.repoData.boards) || []).find(
      (b) => !!b && (b.id === groupKey || b.key === groupKey),
    ) || null
    : null;
  return wrap(
    <ProgressPanel
      dirKey={dirKey}
      task={task}
      group={board}
      rows={app.rows}
      refreshLocal={app.refreshLocal}
      model={app.model}
      onOpenTask={(id, dk) =>
        groupKey
          ? app.openPage && app.openPage({ groupId: groupKey, task: String(id), name: `#${id}` })
          : app.openPage && app.openPage({ dirKey: dk || dirKey, task: String(id), name: `#${id}` })
      }
      onClosePage={(tabId) => app.closePanel && app.closePanel(tabId)}
    />
  );
}

/** 项目组：组里的子目录表（model 要透下去——双链点击要在工作区开文档页签） */
function GroupPanel({ boardId, model }: { boardId?: string; model?: Model | null }) {
  const app = useApp();
  // 组页的刷新自己从 useApp() 取（GroupView 不接 refreshLocal 这个 prop）
  return wrap(
    <GroupView
      dirKey={boardId}
      rows={app.rows}
      repoData={app.repoData}
      model={model || app.model}
    />
  );
}

function OverviewPanel() {
  const app = useApp();
  return wrap(<OverviewView rows={app.rows} onNavigate={app.onNavigate} refreshLocal={app.refreshLocal} />);
}

/** 面板表项：render 拿面板自己的 config 与 factory 递来的运行时句柄。 */
interface PanelEntry {
  title: string;
  render: (cfg: PanelConfig, ctx: PanelCtx) => ReactNode;
}

export const PANELS: Record<string, PanelEntry> = {
  sidebar: { title: '目录', render: () => <SidebarPanel /> },
  welcome: { title: '开始', render: () => <WelcomePanel /> },
  dir: { title: '目录', render: (cfg) => <DirPanelView dirKey={cfg && cfg.dirKey} /> },
  page: { title: '页面', render: (cfg, ctx) => (
    <PagePanelView
      dirKey={cfg && cfg.dirKey}
      groupId={cfg && cfg.groupId}
      task={cfg && cfg.task}
      beside={cfg && cfg.beside}
      historyId={cfg && cfg.historyId}
      tabId={ctx && ctx.tabId}
      model={ctx && ctx.model}
    />
  ) },
  progress: { title: '进程', render: (cfg) => <ProgressPanelView dirKey={cfg && cfg.dirKey} task={cfg && cfg.task} groupKey={cfg && cfg.groupKey} /> },
  // 文档列表（refs）：右侧栏与进程同位（单面板位，开一块顶掉另一块）
  // repoKey / boardKey 二选一寻址；model 透下去——点行要在工作区开文档页签
  refs: { title: '文档列表', render: (cfg, ctx) => wrap(
    <RefsPanel
      repoKey={cfg && cfg.repoKey}
      boardKey={cfg && cfg.boardKey}
      boardName={cfg && cfg.boardName}
      model={ctx && ctx.model}
    />
  ) },
  group: { title: '项目组', render: (cfg, ctx) => <GroupPanel boardId={cfg && cfg.boardId} model={ctx && ctx.model} /> },
  repos: { title: '仓库管理', render: () => wrap(<ReposView />) },
  cloud: { title: '云端总览', render: () => wrap(<TodoView />) },
  overview: { title: '全部目录总览', render: () => <OverviewPanel /> },
  // 任务模板：编辑宿主（#135）——列表在设置卡片；config 带 mode/id/scope
  templates: {
    title: '任务模板',
    render: (cfg, ctx) => wrap(
      <TemplatePanel config={cfg} model={ctx && ctx.model} tabId={ctx && ctx.tabId} />
    ),
  },
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
  // 评论 / 反馈编辑面板（#104）：工作区里新开一块 md 编辑页（顶部带引用信息）
  compose: { title: '评论', render: (cfg) => wrap(
    <ComposePanel
      token={cfg && cfg.token}
      mode={cfg && cfg.mode}
      quote={cfg && cfg.quote}
      prevQuote={cfg && cfg.prevQuote}
      taskLabel={cfg && cfg.taskLabel}
      taskTitle={cfg && cfg.taskTitle}
      src={cfg && cfg.src}
    />
  ) },
  // 编排：可视化 DAG 面板（目录与项目组共用；dirKey=队列，groupId=组内切队列）
  dag: {
    title: '编排',
    render: (cfg) => wrap(<DagPanel dirKey={cfg && cfg.dirKey} groupId={cfg && cfg.groupId} />),
  },
};

/**
 * 开设置面板（浮动）。单独一个入口：齿轮按钮、窄轨齿轮、未来的快捷键都走它，
 * 「设置以浮动形态出现」这件事只在这里定义一次。
 */
export function openSettingsPanel(model: Model | null | undefined) {
  if (!model) return null;
  return openFloatingPanel(model, { component: 'settings', name: '设置', config: {} });
}

/**
 * 打开模板全屏编辑（#135）。管理列表在设置；这里只承载 MdPanes。
 */
export function openTemplateEditor(model: Model | null | undefined, opts: TemplateEditorOpts = {}) {
  if (!model) return null;
  const mode = opts.mode || (opts.id ? 'edit' : 'new');
  const config: PanelConfig = {
    mode,
    id: opts.id || '',
    name: opts.name || '',
    topic: opts.topic || '',
    scope: Array.isArray(opts.scope) ? opts.scope : [],
  };
  const tabName = mode === 'new' ? '新建模板' : (opts.name || '编辑模板');
  return openPanel(model, { component: 'templates', name: tabName, config, location: 'center' });
}

/** 面板类型清单（总览页/文档里的固定顺序；旧「＋面板抽屉」已删，面板打开走侧栏树与路由） */
export const PANEL_ORDER = ['overview', 'group', 'repos', 'cloud'];

/**
 * FlexLayout 的 factory：只认 component 字符串，参数从 config 取。
 * 额外把 model / tabId 传给面板——面板要改**自己**的 config 时需要它们。
 */
export function factory(node: TabNode) {
  const p = PANELS[node.getComponent() || ''];
  if (!p) {
    return <div className="muted" style={{ padding: 12 }}>未知面板：{node.getComponent()}</div>;
  }
  // #185：每个面板自己兜一层错误边界。FlexLayout 自带的那层只画
  // 「Error rendering component」+ Retry，把真实报错和堆栈全吞了——用户只能报「白屏」，
  // 排查时得靠猜。换成自家边界：message 直接摊在面板里，单块面板重试，其它页签不受影响。
  return (
    <ErrorBoundary key={node.getId()}>
      {p.render(node.getConfig() || {}, { tabId: node.getId(), model: node.getModel(), node })}
    </ErrorBoundary>
  );
}

// ─── 路由 ↔ 面板 ────────────────────────────────────────────────
//
// 纯映射抽在 route-map.js（不引 React，单测可直接 import）——这里只转出口，
// 既有引用面（App.jsx 等）不用改。
export { GLOBAL_KEY, routeOfPanel, panelSpecOfRoute } from './route-map.js';
