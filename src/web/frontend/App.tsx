// 应用壳 v2 —— FlexLayout 工作区。
//
// **没有顶栏**：全局动作（布局撤销重做 / 设置）全部集中在侧边栏头部——
// 侧边栏是工作区里的一块面板，可拖拽可浮出，动作跟着它走；收起成窄轨时
// 仍保留设置入口（见 sidebar/panel）。面板的打开一律走侧栏树 / 路由 / 页内动作，
// 不设「凭空开面板」的抽屉入口。
//
// **面板是一等公民**：目录、目录工作台、项目组、仓库管理、云端总览……都是工作区里的
// 一块面板，可拖拽、可拆分、可拖出成浮窗；布局存 localStorage，重开还在。
//
// 路由与「选中的面板」互为镜像：
//   路由变化 → 打开/聚焦对应面板；选中面板变化 → 地址跟着走（replaceState）。
// 所以深链 = 一屏：把地址发给别人，对方看到的布局与你一致。
//
// hash 路由：
//   #/dir/<key>  目录详情    #/global  全局任务池   #/overview  全部目录总览
//   #/group/<id> 项目组      #/repos     仓库管理      #/overview  总览
//   #/templates  任务模板（面板，不是弹窗）
//   （经典看板 #/localtask 已下线；wait 深链改落 #/dir/<key>）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Layout, Actions, DockLocation, defaultKeyMap } from 'flexlayout-react';
import type { Action, Model, Node, TabNode, TabSetNode, ILayoutApi } from 'flexlayout-react';
import { useStore } from './store.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import { useToast } from './components/toast/index.jsx';
import { useDialog } from './components/popup/index.jsx';
import { api } from './api/client.js';
import { Icon } from './components/icons.jsx';
import { AppContext } from './app-context.jsx';
import { factory, routeOfPanel, panelSpecOfRoute, openSettingsPanel } from './panels.jsx';
import { decodeDocRef } from './route-map.js';
import {
  activeTab,
  clearStoredModel,
  configSig,
  loadModel,
  openPanel,
  pruneBlankTabsets,
  saveModel,
} from './workspace.js';
import { useTemplates } from './modules/md/use-templates.js';
import { findGroupTask } from './modules/board/board-view.js';
import { installAttachmentPreview } from './modules/md/lightbox.js';
import { loadPrefs, updatePrefs } from './prefs.js';
import SidebarRescueFab from './components/sidebar/rescue-fab.jsx';
import { pushRoute } from './components/layout/route-history.js';
import type { AppRoute, BoardRow, LocaltasksData, LocalTask, LocalTopic, Prefs, RepoData, RepoRow, SpecCtx } from './types.js';
import type { AppValue } from './app-context.jsx';

// 只借 FlexLayout 的**结构 CSS**（盒模型与拖拽几何）——不引它的配色：
// 配色全部由 style-v2.css 里的 --flexlayout-* 变量覆写接管（跟 nx-sk 同一套做法）。
import 'flexlayout-react/style/light.css';

/**
 * float 布局对象：flexlayout 内部的 Layout 类，**包里的 .d.ts 没有导出**
 * （Model.getLayouts 也未声明）。这里只声明我们真正用到的三个口子，
 * 术语与库内部一致；库升级时若改了这三个方法，类型检查会先炸在编译期。
 */
interface FloatLayoutLike {
  getType(): string;
  getRect(): { x: number; y: number; width: number; height: number };
  visitNodes(fn: (node: Node) => void): void;
}

/** Model + 未声明的 getLayouts（见上）。 */
type ModelWithLayouts = Model & { getLayouts(): Map<string, FloatLayoutLike> };

// hash → 路由对象。带 query 的 #/dir/<key>?task=… 是**某一页**的深链（页签面板）。
function routeFromHash(): AppRoute {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [path = '', query] = h.split('?');
  const qs = new URLSearchParams(query || '');
  const task = qs.get('task') || '';
  if (path.startsWith('dir/')) {
    return { view: 'dir', key: decodeURIComponent(path.slice(4)), task };
  }
  // 项目组详情：组里的子目录表（点击侧栏的项目组行进来）；?task=N 是组内某一页的
  // 深链（组任务详情路由，#86）——组页与目录页一样带任务段
  if (path.startsWith('group/')) {
    return { view: 'group', key: decodeURIComponent(path.slice(6)), task };
  }
  // 文档页（#88）：#/doc?ref=<docId>[&repo=<repoKey>|&board=<boardId>&name=<组名>]
  // docId 是 `rel:` / `path:` 前缀寻址，**不要**整体 encodeURIComponent——
  // 面板 config 要能逐字复现（openPanel 按 component+config 去重），
  // 编码方式一变就裂成两个面板。只编码冒号后的路径段。
  if (path === 'doc') {
    const ref = qs.get('ref') || '';
    const repo = qs.get('repo') || '';
    const board = qs.get('board') || '';
    const name = qs.get('name') || '';
    const docId = ref ? decodeDocRef(ref) : '';
    return {
      view: 'doc',
      key: docId,
      task: '',
      repoKey: repo,
      boardKey: board,
      boardName: name,
    };
  }
  // 任务模板编辑（#137）：#/templates/new[?scope=&topic=] / #/templates/edit/<id>
  // 必须带 mode，否则会与空 config 的「目录页」互相冲掉全屏编辑器。
  if (path === 'templates' || path.startsWith('templates/')) {
    const rest = path === 'templates' ? '' : path.slice('templates/'.length);
    if (rest.startsWith('edit/')) {
      return {
        view: 'templates',
        key: '',
        task: '',
        mode: 'edit',
        id: decodeURIComponent(rest.slice(5)),
        topic: '',
        scope: '',
      };
    }
    if (rest === 'new') {
      return {
        view: 'templates',
        key: '',
        task: '',
        mode: 'new',
        id: '',
        topic: qs.get('topic') || '',
        scope: qs.get('scope') || '',
      };
    }
    return { view: 'templates', key: '', task: '', mode: '', id: '', topic: '', scope: '' };
  }
  const KNOWN = ['global', 'overview', 'repos'];
  if (KNOWN.includes(path)) {
    // 全局池的页：#/global?task=1 —— 全局池的子任务表与页都在同一路由下
    return { view: path, key: path === 'global' ? '__GLOBAL__' : '', task: path === 'global' ? task : '' };
  }
  // 旧深链（#/localtask?…）与未知路径统一落总览
  return { view: 'overview', key: '', task: '' };
}

/** FlexLayout 自带的右键菜单是英文。只翻译**用得到的**几条；没翻的原样透出。 */
const I18N: Record<string, string> = {
  close: '关闭',
  rename: '重命名',
  float: '浮窗',
  dock: '停靠',
  popout: '弹出到新窗口',
  Close: '关闭',
  Rename: '重命名',
  Float: '浮窗',
  Dock: '停靠',
  Popout: '弹出到新窗口',
  'flexlayout.ui.dock.float.tabs (?)': '迁回 ? 个页签',
};
const translate = (msg: string): string => I18N[msg] || msg;

export default function App() {
  const { boot } = useStore();
  const toast = useToast();
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  // 等待回填数：只为捕捉 0→n 跳变弹 toast（值本身不上屏）
  const [, setWaitingCount] = useState<number>(0);
  const [localData, setLocalData] = useState<LocaltasksData | null>(null); // /api/localtasks 结果
  // 任务模板：App 层持有一份（「任务模板」面板与 MD 工作台的「模板 ▾」共用，
  // 面板里增删/设默认后工作台的列表与默认正文即时跟随，不会各持一份旧数据）
  const tpl = useTemplates();
  const layoutRef = useRef<ILayoutApi | null>(null);

  // 工作区模型（布局的唯一真源）。布局撤销/重做已整体下线（#96）：
  // useUndo 的逐动作全量快照在没有撤销入口后只剩开销，模型管理回退普通 state。
  const [model, setModel] = useState<Model | null>(() => loadModel());
  // 调试探针句柄：自动化测试需要模型级观测/驱动（拖拽链路、float 布局等无法从 DOM 反查）。
  // 只读暴露；生产环境多一个 window 属性无副作用。
  useEffect(() => {
    if (model) {
      (window as unknown as { __nxkv?: unknown }).__nxkv = { model, Actions, DockLocation };
    }
  }, [model]);

  const patchPrefs = useCallback((patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => {
    setPrefs(updatePrefs(patch));
  }, []);

  // ─── 路由：hashchange 单向同步（navigate 就是写 hash）───
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 附件预览（任务 #71）：文档级委托——图片点击放大、PDF 内置预览。装一次即覆盖全部渲染面。
  useEffect(() => installAttachmentPreview(), []);

  const onNavigate = useCallback((hash: string) => {
    if (location.hash !== hash) location.hash = hash;
    // 地址变了要**立刻**把路由状态跟上。hashchange 是异步派发的，中间隔着一个
    // 渲染周期；这一拍里任何数据刷新（例如「先建队列再跳」跳完接着刷新队列）
    // 都会让「路由 → 面板」effect 按**旧路由**再跑一次 openPanel，而它触发的
    // onModelChange 会把地址改回旧值 —— 实测：项目组里点没有队列的目录，
    // 队列建好了、hash 也写了，两拍后又被弹回 #/group/…。
    setRoute((prev) => {
      const next = routeFromHash();
      return prev.view === next.view && prev.key === next.key && prev.task === next.task ? prev : next;
    });
  }, []);

  // ─── 本机队列数据：侧栏与各面板共用一份（15s 轮询 + 操作后手动刷新）───
  const refreshLocal = useCallback(async () => {
    try {
      setLocalData(await api<LocaltasksData>('/api/localtasks'));
    } catch {
      /* 读失败：保留旧数据，侧栏仍可用 */
    }
  }, []);
  useEffect(() => {
    refreshLocal();
    const t = setInterval(refreshLocal, 15_000);
    return () => clearInterval(t);
  }, [refreshLocal]);

  // ─── 仓库与看板：侧栏的**唯一数据源** ───
  const [repoData, setRepoData] = useState<RepoData>({ repos: [], boards: [] });
  const refreshRepos = useCallback(async () => {
    try {
      const [repos, boards] = await Promise.all([
        api<RepoRow[]>('/api/repos'),
        api<{ boards?: RepoData['boards'] }>('/api/boards'),
      ]);
      setRepoData({
        repos: (repos || []).filter((r) => (r.type || 'dev') !== 'ref'), // 参考仓库不进侧栏
        boards: (boards && boards.boards) || [],
      });
    } catch {
      /* 读失败：保留旧数据，侧栏仍可用 */
    }
  }, []);
  useEffect(() => {
    refreshRepos();
    const t = setInterval(refreshRepos, 30_000);
    return () => clearInterval(t);
  }, [refreshRepos]);

  // ─── 等待回填提醒 ───
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const d = await api<{ waiting?: number }>('/api/localtasks/presence');
        const n = Math.max(0, Number(d && d.waiting) || 0);
        if (stopped) return;
        setWaitingCount((prev) => {
          if (prev === 0 && n > 0) toast('有 agent 正在等待回填，请查看对应目录');
          return n;
        });
      } catch { /* 瞬时失败：下一轮再查 */ }
    };
    check();
    const t = setInterval(check, 15_000);
    return () => { stopped = true; clearInterval(t); };
  }, [toast]);

  // ─── 心跳：给 serve --auto-exit 上报「面板还开着」───
  useEffect(() => {
    let stopped = false;
    const beat = () => { if (!stopped) api('/api/ping').catch(() => {}); };
    beat();
    const t = setInterval(beat, 15_000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const rows = useMemo(() => localData?.topics || [], [localData]);

  // ─── 布局落盘 + 空壳自愈：模型变了就存；变化后顺手删掉空 tabset ───
  // 浮窗（float）路径会在原位留一个无标题、无关闭按钮的空 tabset（库不 tidy），
  // 表现为「一块删不掉的空白面板」。在 onAfterAction 里兜底剪掉。
  // 剪枝的 doAction 会嵌套再触发一次 change（被 pruningRef 挡住）——
  // 所以剪完必须**在本轮内**接着 saveModel，不能指望下一轮（否则剪掉的壳永远不落盘）。
  // DELETE_TABSET 不进撤销历史：剪空壳不是用户操作，不该占一步「撤销」。
  const pruningRef = useRef(false);
  useEffect(() => {
    if (!model) return undefined;
    const listener = {
      onAfterAction: () => {
        if (pruningRef.current) return;
        pruningRef.current = true;
        try {
          pruneBlankTabsets(model);
          saveModel(model);
        } finally {
          pruningRef.current = false;
        }
      },
    };
    model.addChangeListener(listener);
    return () => model.removeChangeListener(listener);
  }, [model]);

  // ─── 浮窗关闭：× 放窗口头右上角 ───
  // 库把页签的关闭按钮画在页签内——浮窗里那一行就落在标题「设置 ×」后面，看着像页面里的×，
  // 反直觉。这里在浮窗头部注入一颗关闭按钮，关闭浮窗里的当前页签
  // （单页签浮窗随之整体消失）；页签条里那颗由 style-v2.css 隐藏，避免出现两个×。
  // 浮窗头部不再有「迁回主布局」「弹出到浏览器窗口」（#91：用户不需要在浮窗头上挑
  // 落点；迁回可拖手柄到面板边缘，弹出被 tabEnablePopout=false 关闭）。
  const closeFloatTab = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!model) return;
    const m = model as ModelWithLayouts;
    const floats = [...m.getLayouts().entries()].filter(([, l]) => l.getType() === 'float');
    const first = floats[0];
    if (!first) return;
    const winEl = e.currentTarget.closest('.flexlayout__float_window') as HTMLElement | null;
    let layoutId: string = first[0];
    if (floats.length > 1 && winEl) {
      // 多浮窗：按 DOM 位置匹配最近的 float layout（模型 rect 与 DOM 同为根容器相对坐标）
      const rr = winEl.offsetParent ? winEl.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
      const wr = winEl.getBoundingClientRect();
      let best: { id: string; d: number } | null = null;
      for (const [id, l] of floats) {
        const r = l.getRect();
        const d = Math.abs(r.x - (wr.left - rr.left)) + Math.abs(r.y - (wr.top - rr.top));
        if (!best || d < best.d) best = { id, d };
      }
      layoutId = best ? best.id : layoutId;
    }
    const layout = m.getLayouts().get(layoutId);
    if (!layout) return;
    // 浮窗里只有一个根 tabset：取它的选中页签
    let tab: TabNode | null = null;
    layout.visitNodes((node) => {
      // 只有 TabSetNode 才有「选中页签」这个概念（RowNode/BorderNode 没有）
      if (!tab && typeof (node as TabSetNode).getSelectedNode === 'function') {
        tab = (node as TabSetNode).getSelectedNode() || null;
      }
    });
    // 回调里赋值的那一拍 TS 的流分析看不见（它把 tab 当成恒 null），这里显式抹平
    const found = tab as TabNode | null;
    if (found && found.isCloseable()) model.doAction(Actions.deleteTab(found.getId()));
  }, [model]);

  // ─── 路由 → 面板：地址指向哪块，就打开/聚焦哪块 ───
  const specCtx = useMemo<SpecCtx>(() => {
    // group 路由的 key = 看板 id；dir 路由的 key = 主题 key——两组身份别混。
    // 组名只给组页的面板命名用——仓库是独立模块，仓库路由不再向上挂组（#84）。
    if (route.view === 'group') {
      // 组路由带 ?task=（#86）：页名要从成员队列里搜出这条任务才知道
      // board-view 还是 JS：它返回的三元组被推成「恒 null」，这里按真实形状收窄
      // （board-view 毕业成 .ts 后这层断言即可去掉）。
      const g = findGroupTask(rows, repoData.boards || [], route.key, route.task) as {
        board?: BoardRow | null;
        topic?: LocalTopic | null;
        taskRow?: LocalTask | null;
      };
      return {
        boardName: (g.board && g.board.name) || '',
        dirName: g.topic ? g.topic.name : '',
        pageTitle: g.taskRow ? `#${g.taskRow.id}` : '',
      };
    }
    const boardById = (repoData.boards || []).find((b) => b.id === route.key);
    const topic = rows.find((r) => r.key === route.key);
    const taskRow = topic && route.task
      ? (topic.tasks || []).find((t) => String(t.id) === String(route.task))
      : null;
    // 文档页（#88）：面板名用文档末段名**原始**字节——面板名一旦被二次解码/编码，
    // panelSpecOfRoute 与当前面板的 name 就对不上，去重会裂。归属名供面包屑用。
    // 注意 route.key 是 parse 过的原文（可能是「某 个库」「前端组/a b.md」）：
    // hash 把 ref 剥出来时 URLSearchParams 已经做过一次解码，这里只管切段。
    if (route.view === 'doc') {
      const seg = String(route.key || '').replace(/^(rel|path):/, '').split(/[\\/]/).filter(Boolean).pop() || '';
      // `x || []` 在联合数组上会把 find 的回调解成 never，先落到显式类型再查
      const repos: RepoRow[] = repoData.repos || [];
      const boards: RepoData['boards'] = repoData.boards || [];
      const repo = repos.find((r) => r.key === route.repoKey);
      const board = boards.find((b) => b.id === route.boardKey || b.key === route.boardKey);
      return {
        boardName: route.boardName || (board && board.name) || '',
        dirName: '',
        pageTitle: seg.replace(/\.md$/i, ''),
        repoName: (repo && repo.name) || '',
      };
    }
    return {
      boardName: (boardById && boardById.name) || '',
      dirName: topic ? topic.name : '',
      pageTitle: taskRow ? `#${taskRow.id}` : '',
    };
  }, [repoData.boards, repoData.repos, rows, route.view, route.key, route.task, route.repoKey, route.boardKey, route.boardName]);

  // 路由 → 面板：地址指向哪块，就打开/聚焦哪块。
  // **只跟路由走**（模型用 ref）：模型一变就重跑，会按**旧路由**把面板抢回去
  // （点任务开页签 → 模型变 → effect 按旧路由重选目录面板 → 页签被顶掉）。
  // 路由变化记进历史栈——面板内面包屑「点路径返回」按来处回（见 route-history）
  useEffect(() => {
    pushRoute(location.hash);
  }, [route.view, route.key, route.task, route.repoKey, route.boardKey]);

  const modelRef = useRef<Model | null>(model);
  useEffect(() => { modelRef.current = model; }, [model]);

  // 同理不能跟 specCtx 的**身份**走：rows 每 15s 轮询换一次新数组，
  // specCtx 就重算一次 → effect 重跑 → 按**旧路由**把用户刚开的页签顶掉
  // （实测：从目录页点开文档页签，十几秒后文档面板自己没了）。
  // 只在「路由变了」或「面板名变了」时重开 —— 名字没变就别抢焦点。
  const specCtxRef = useRef<SpecCtx>(specCtx);
  useEffect(() => { specCtxRef.current = specCtx; }, [specCtx]);
  const specCtxKey = `${specCtx.boardName}|${specCtx.dirName}|${specCtx.pageTitle}`;
  const openedRef = useRef({ route: '', key: '' });

  useEffect(() => {
    const m = modelRef.current;
    if (!m) return;
    const spec = panelSpecOfRoute(route, specCtxRef.current);
    if (!spec) return;
    const routeSig = `${route.view}|${route.key}|${route.task}|${route.repoKey || ''}|${route.boardKey || ''}|${route.mode || ''}|${route.id || ''}|${route.topic || ''}|${route.scope || ''}`;
    const prev = openedRef.current;
    if (prev.route === routeSig && prev.key === specCtxKey) return;
    openedRef.current = { route: routeSig, key: specCtxKey };
    openPanel(m, spec);
  }, [route, specCtxKey]);

  /** 开一个 MD 页签（工作区页签，不是工作台内部的 tab）
   *  spec.groupId（#86）= 组锚定页：组任务详情，成员队列由面板内部解析 */
  const openPage = useCallback((spec: { name?: string; groupId?: string; dirKey?: string; task?: string; location?: string }) => {
    if (!model) return;
    openPanel(model, {
      component: 'page',
      name: spec.name || '页面',
      // 组锚定页（#86）：config 恰为 {groupId, task}，与 panelSpecOfRoute 逐字互逆
      // （去重按 configSig 序无关比，但形态一致才不会在 routeOfPanel 写回时多出 dirKey:undefined）
      config: spec.groupId
        ? { groupId: spec.groupId, task: spec.task }
        : { dirKey: spec.dirKey, task: spec.task },
      location: spec.location || 'center',
    });
  }, [model]);

  const closePanelById = useCallback((tabId: string) => {
    if (!model || !tabId) return;
    model.doAction(Actions.deleteTab(tabId));
  }, [model]);

  // ─── 选中的面板 → 路由：地址跟着走（replaceState，不触发 hashchange，避免来回抖）──
  // 只有「选中项真的换了」才改地址：openPanel 复用一个已经打开的面板时也会走一次
  // selectTab，数据刷新重跑 effect 造成的这种**空选**会把刚跳过去的地址改回旧路由。
  const lastActiveRef = useRef<string | null>(null);
  const onModelChange = useCallback(() => {
    if (!model) return;
    const node = activeTab(model) as TabNode | null;
    if (!node) return;
    const activeId = node.getId();
    const prevActiveId = lastActiveRef.current;
    lastActiveRef.current = activeId;
    if (prevActiveId === activeId) return;
    const r = routeOfPanel(node);
    if (!r) return;
    // 当前地址**是否已经指向这块面板**？按面板身份比（component + config），
    // 不能比字符串前缀 —— 「#/dir/x」与「#/dir/x?task=1」指向的是两块不同的面板。
    const curSpec = panelSpecOfRoute(routeFromHash(), specCtx);
    const same =
      curSpec &&
      curSpec.component === node.getComponent() &&
      configSig(curSpec.config || {}) === configSig(node.getConfig() || {});
    if (same) return;
    history.replaceState(null, '', r);
    // replaceState 不触发 hashchange —— 路由状态要**自己**跟上，否则它停在旧值，
    // 下一轮路由 effect 会按旧路由把面板抢回去。
    const next = routeFromHash();
    setRoute((prev) => (
      prev.view === next.view
      && prev.key === next.key
      && prev.task === next.task
      && prev.repoKey === next.repoKey
      && prev.boardKey === next.boardKey
      && prev.boardName === next.boardName
      && prev.mode === next.mode
      && prev.id === next.id
      && prev.topic === next.topic
      && prev.scope === next.scope
        ? prev
        : next
    ));
  }, [model, specCtx]);

  // 确认用应用内弹窗（useDialog，可用键盘 Esc / 点蒙层取消），不用原生 confirm。
  const { dialog, node: dialogNode } = useDialog();

  const resetLayout = useCallback(async () => {
    const ok = await dialog({
      title: '重置为初始两栏',
      message: '丢掉存下来的布局，回到初始的两栏（目录 + 开始）？',
      okText: '重置',
    });
    if (!ok) return;
    clearStoredModel();
    setModel(loadModel());
  }, [dialog, setModel]);

  // 全局动作：集中在侧边栏头部（窄轨保留设置入口）；布局撤销/重做已下线（#96）
  const shell = useMemo(
    () => ({
      resetLayout,
      // 设置 = 浮动面板：临时开一块、看完就关（重复点只聚焦已开的那块）
      openSettings: () => openSettingsPanel(model),
    }),
    [resetLayout, model]
  );

  const appValue = useMemo<AppValue>(
    () => ({
      boot, rows, repoData, prefs, patchPrefs, onNavigate, refreshLocal, refreshRepos, tpl, model, route,
      // 队列首轮是否已加载完：面板据此区分「还在读」与「确实没有这条任务」
      localReady: localData !== null,
      openPage, closePanel: closePanelById,
      shell,
    }),
    [boot, rows, repoData, prefs, patchPrefs, onNavigate, refreshLocal, refreshRepos, tpl, model, route, openPage, closePanelById, shell]
  );

  return (
    <AppContext.Provider value={appValue}>
      <div id="app-shell" className="nx-shell">
        {/* 工作区：顶部面包屑（位置指示——页签已删）+ 面板区
            （全局动作在侧边栏头部，见 sidebar/index.jsx） */}
        <div className="nx-workarea">
          {model ? (
            <ErrorBoundary key="workspace">
              <Layout
                ref={layoutRef}
                model={model}
                factory={factory}
                onAction={(action: Action) => action}
                onModelChange={onModelChange}
                i18nTranslator={translate}
                // 默认只有「关闭页签 / 重命名」有键位；焦点在面板组之间移动的三条默认是关的——
                // 不开它们，键盘用户进得来出不去
                keyMap={{
                  ...defaultKeyMap,
                  focusTabToggle: 'F6',
                  focusNextTabset: 'Ctrl+F6',
                  focusPreviousTabset: 'Ctrl+Shift+F6',
                }}
                // 浮窗头部的拖拽手柄：库里原生渲染「弹出到浏览器窗口」图标（#91 关闭，
                // tabEnablePopout=false）和「迁回主布局」按钮（#91 删除——落点由策略表决定，
                // 迁回走拖拽）。这里借 icons.dragToDock 槽位只挂一颗「关闭浮窗」×。
                icons={{
                  dragToDock: (
                    <button
                      type="button"
                      className="flx-float-close"
                      title="关闭浮窗"
                      aria-label="关闭浮窗"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); closeFloatTab(e); }}
                    >
                      <Icon name="x" size={14} title={undefined} />
                    </button>
                  ),
                }}
              />
              {/* 关闭态把手挂在壳层：侧栏 weight≈0 时 panel 不挂载也能展开 */}
              <SidebarRescueFab model={model} />
              {/* 壳层弹窗（.dlg 是 fixed 全屏蒙层，挂哪一层都盖住整窗）——
                  目前只有页签条「清空本组」的确认框用 */}
              {dialogNode}
            </ErrorBoundary>
          ) : (
            <div className="pad muted">正在装载工作区…</div>
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}
