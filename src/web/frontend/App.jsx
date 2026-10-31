// 应用壳 v2 —— 顶栏 + FlexLayout 工作区 + 状态条。
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
//   #/group/<id> 项目组      #/cloud   云端总览      #/repos     仓库管理
//   #/templates  任务模板（面板，不是弹窗）
//   （经典看板 #/localtask 已下线；wait 深链改落 #/dir/<key>）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Actions, DockLocation, defaultKeyMap, useUndo } from 'flexlayout-react';
import { useStore } from './store.jsx';
import { ErrorBoundary, useToast } from './components/ui.jsx';
import { api } from './api/client.js';
import { Icon } from './components/icons.jsx';
import { PopMenu } from './components/overlay.jsx';
import { AppContext } from './app-context.jsx';
import { PANELS, PANEL_ORDER, factory, routeOfPanel, panelSpecOfRoute } from './panels.jsx';
import {
  WORKSPACE_KEY,
  activeTab,
  clearStoredModel,
  layoutStats,
  loadModel,
  openPanel,
  pruneBlankTabsets,
  saveModel,
} from './workspace.js';
import { useTemplates } from './modules/md-workspace/use-templates.js';
import { cfgMenuItems } from './components/sidebar/row-menu.jsx';
import { loadPrefs, updatePrefs } from './prefs.js';

// 只借 FlexLayout 的**结构 CSS**（盒模型与拖拽几何）——不引它的配色：
// 配色全部由 style-v2.css 里的 --flexlayout-* 变量覆写接管（跟 nx-sk 同一套做法）。
import 'flexlayout-react/style/light.css';

// hash → 路由对象。带 query 的 #/dir/<key>?task=… 是**某一页**的深链（页签面板）。
function routeFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const task = new URLSearchParams(query || '').get('task') || '';
  if (path.startsWith('dir/')) {
    return { view: 'dir', key: decodeURIComponent(path.slice(4)), task };
  }
  // 项目组详情：组里的子目录表（点击侧栏的项目组行进来）
  if (path.startsWith('group/')) {
    return { view: 'group', key: decodeURIComponent(path.slice(6)), task: '' };
  }
  const KNOWN = ['global', 'overview', 'cloud', 'todo', 'repos', 'templates'];
  if (KNOWN.includes(path)) {
    // 全局池的页：#/global?task=1 —— 全局池的子任务表与页都在同一路由下
    return { view: path === 'todo' ? 'cloud' : path, key: path === 'global' ? '__GLOBAL__' : '', task: path === 'global' ? task : '' };
  }
  // 旧深链（#/localtask?…）与未知路径统一落总览
  return { view: 'overview', key: '', task: '' };
}

/** FlexLayout 自带的右键菜单是英文。只翻译**用得到的**几条；没翻的原样透出。 */
const I18N = {
  close: '关闭',
  rename: '重命名',
  maximize: '最大化',
  restore: '还原',
  float: '浮窗',
  dock: '停靠',
  popout: '弹出到新窗口',
  Close: '关闭',
  Rename: '重命名',
  Maximize: '最大化',
  Restore: '还原',
  Float: '浮窗',
  Dock: '停靠',
  Popout: '弹出到新窗口',
  // 浮窗头部的两个图标与拖拽提示（原文是 flexlayout.ui.* 键名）
  'flexlayout.ui.dock.float.to.layout': '迁回主布局（点按钮直接停靠；也可拖到面板边缘）',
  'flexlayout.ui.popout.float.to.window': '弹出到浏览器窗口',
  'flexlayout.ui.dock.float.tabs (?)': '迁回 ? 个页签',
};
const translate = (msg) => I18N[msg] || msg;

const DOCKS = [
  ['center', '中间'],
  ['left', '左'],
  ['right', '右'],
  ['top', '上'],
  ['bottom', '下'],
];

export default function App() {
  const { boot } = useStore();
  const toast = useToast();
  const [route, setRoute] = useState(routeFromHash);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [waitingCount, setWaitingCount] = useState(0);
  const [localData, setLocalData] = useState(null); // /api/localtasks 结果
  const [localErr, setLocalErr] = useState('');
  // 任务模板：App 层持有一份（「任务模板」面板与 MD 工作台的「模板 ▾」共用，
  // 面板里增删/设默认后工作台的列表与默认正文即时跟随，不会各持一份旧数据）
  const tpl = useTemplates();
  const [menu, setMenu] = useState(null);       // 设置气泡
  const [drawer, setDrawer] = useState(null);   // 面板抽屉 {dock}
  const [stats, setStats] = useState({ tabsets: 0, tabs: 0 });
  const layoutRef = useRef(null);

  // 工作区模型（布局的唯一真源）；撤销/重做整段拖拽折叠成一步。
  // 空壳剪枝（DELETE_TABSET）不算用户操作，排除出撤销/重做历史。
  const { model, setModel, undo, redo, canUndo, canRedo } = useUndo(() => loadModel(), {
    ignoreActionTypes: [Actions.SET_ACTIVE_TABSET, Actions.DELETE_TABSET],
  });
  // 调试探针句柄：自动化测试需要模型级观测/驱动（拖拽链路、float 布局等无法从 DOM 反查）。
  // 只读暴露；生产环境多一个 window 属性无副作用。
  useEffect(() => {
    if (model) window.__nxkv = { model, Actions };
  }, [model]);

  const patchPrefs = useCallback((patch) => setPrefs(updatePrefs(patch)), []);

  // ─── 路由：hashchange 单向同步（navigate 就是写 hash）───
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onNavigate = useCallback((hash) => {
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
      const d = await api('/api/localtasks');
      setLocalData(d);
      setLocalErr('');
    } catch (e) {
      setLocalErr(String(e.message || e));
    }
  }, []);
  useEffect(() => {
    refreshLocal();
    const t = setInterval(refreshLocal, 15_000);
    return () => clearInterval(t);
  }, [refreshLocal]);

  // ─── 仓库与看板：侧栏的**唯一数据源** ───
  const [repoData, setRepoData] = useState({ repos: [], boards: [] });
  const refreshRepos = useCallback(async () => {
    try {
      const [repos, boards] = await Promise.all([api('/api/repos'), api('/api/boards')]);
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
        const d = await api('/api/localtasks/presence');
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

  // ─── 浮窗迁回：点手柄上的「迁回」直接停靠回主布局 ───
  // 库的迁回只有「拖手柄到根行外沿 10px × 边中点 ±50px 的隐形窄带」一条路（实测），
  // 正中/普通边缘落点全部静默忽略——用户几乎不可能拖对。这里补点击直达：
  // 目标 = 主布局活动 tabset（无则第一个）；方位 = 浮窗相对目标的主轴方向。
  const dockFloatBack = useCallback((e) => {
    if (!model) return;
    const floats = [...model.getLayouts().entries()].filter(([, l]) => l.getType() === 'float');
    if (!floats.length) return;
    const winEl = e.currentTarget.closest('.flexlayout__float_window');
    let layoutId = floats[0][0];
    if (floats.length > 1 && winEl) {
      // 多浮窗：按 DOM 位置匹配最近的 float layout（模型 rect 与 DOM 同为根容器相对坐标）
      const rr = winEl.offsetParent ? winEl.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
      const wr = winEl.getBoundingClientRect();
      let best = null;
      for (const [id, l] of floats) {
        const r = l.getRect();
        const d = Math.abs(r.x - (wr.left - rr.left)) + Math.abs(r.y - (wr.top - rr.top));
        if (!best || d < best.d) best = { id, d };
      }
      layoutId = best.id;
    }
    const ts = model.getActiveTabset() || model.getFirstTabSet();
    if (!ts) return;
    let location = 'right';
    const fr = model.getLayouts().get(layoutId)?.getRect();
    const tr = typeof ts.getRect === 'function' ? ts.getRect() : null;
    if (fr && tr) {
      const dx = fr.x + fr.width / 2 - (tr.x + tr.width / 2);
      const dy = fr.y + fr.height / 2 - (tr.y + tr.height / 2);
      location = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
    }
    // 注意：dockFloatToLayout 的 location 要 DockLocation 实例（内部调 location.getName()），不能传字符串
    model.doAction(Actions.dockFloatToLayout(layoutId, ts.getId(), DockLocation.getByName(location), -1));
  }, [model]);

  // ─── 路由 → 面板：地址指向哪块，就打开/聚焦哪块 ───
  const specCtx = useMemo(() => {
    const board = (repoData.boards || []).find((b) => b.id === route.key);
    const topic = rows.find((r) => r.key === route.key);
    const taskRow = topic && route.task
      ? (topic.tasks || []).find((t) => String(t.id) === String(route.task))
      : null;
    return {
      boardName: board ? board.name : '',
      dirName: topic ? topic.name : '',
      pageTitle: taskRow ? `#${taskRow.id}` : '',
    };
  }, [repoData.boards, rows, route.key, route.task]);

  // 路由 → 面板：地址指向哪块，就打开/聚焦哪块。
  // **只跟路由走**（模型用 ref）：模型一变就重跑，会按**旧路由**把面板抢回去
  // （点任务开页签 → 模型变 → effect 按旧路由重选目录面板 → 页签被顶掉）。
  const modelRef = useRef(model);
  useEffect(() => { modelRef.current = model; }, [model]);

  useEffect(() => {
    const m = modelRef.current;
    if (!m) return;
    const spec = panelSpecOfRoute(route, specCtx);
    if (!spec) return;
    openPanel(m, spec);
  }, [route, specCtx]);

  /** 开一个 MD 页签（工作区页签，不是工作台内部的 tab） */
  const openPage = useCallback((spec) => {
    if (!model) return;
    openPanel(model, {
      component: 'page',
      name: spec.name || '页面',
      config: { dirKey: spec.dirKey, task: spec.task },
      location: spec.location || 'center',
    });
  }, [model]);

  const closePanelById = useCallback((tabId) => {
    if (!model || !tabId) return;
    model.doAction(Actions.deleteTab(tabId));
  }, [model]);

  // ─── 选中的面板 → 路由：地址跟着走（replaceState，不触发 hashchange，避免来回抖）───
  // 只有「选中项真的换了」才改地址：openPanel 复用一个已经打开的面板时也会走一次
  // selectTab，数据刷新重跑 effect 造成的这种**空选**会把刚跳过去的地址改回旧路由。
  const lastActiveRef = useRef(null);
  const onModelChange = useCallback(() => {
    if (!model) return;
    setStats(layoutStats(model));
    const node = activeTab(model);
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
      JSON.stringify(curSpec.config || {}) === JSON.stringify(node.getConfig() || {});
    if (same) return;
    history.replaceState(null, '', r);
    // replaceState 不触发 hashchange —— 路由状态要**自己**跟上，否则它停在旧值，
    // 下一轮路由 effect 会按旧路由把面板抢回去。
    const next = routeFromHash();
    setRoute((prev) => (
      prev.view === next.view && prev.key === next.key && prev.task === next.task ? prev : next
    ));
  }, [model, specCtx]);

  const resetLayout = useCallback(() => {
    if (!confirm('丢掉存下来的布局，回到初始的两栏（目录 + 开始）？')) return;
    clearStoredModel();
    setModel(loadModel());
  }, [setModel]);

  const openFromDrawer = useCallback((component) => {
    if (!model) return;
    const spec = { component, name: PANELS[component] ? PANELS[component].title : component, config: {}, location: (drawer && drawer.dock) || 'center' };
    // 组/目录面板需要 config（组 id / 目录 key）——从抽屉开时用默认项
    if (component === 'group') {
      const b = (repoData.boards || [])[0];
      if (b) spec.config = { boardId: b.id };
    }
    openPanel(model, spec);
    setDrawer(null);
  }, [model, drawer, repoData.boards]);

  const appValue = useMemo(
    () => ({
      boot, rows, repoData, prefs, patchPrefs, onNavigate, refreshLocal, refreshRepos, tpl, model, localErr, route,
      // 队列首轮是否已加载完：面板据此区分「还在读」与「确实没有这条任务」
      localReady: localData !== null,
      openPage, closePanel: closePanelById,
    }),
    [boot, rows, repoData, prefs, patchPrefs, onNavigate, refreshLocal, refreshRepos, tpl, model, localErr, route, openPage, closePanelById]
  );

  return (
    <AppContext.Provider value={appValue}>
      <div id="app-shell" className="nx-shell">
        {/* 顶栏：只放**全局动作**（目录不进顶栏，目录只从侧栏进 —— 两处入口必然分叉） */}
        <header className="nx-top">
          <span className="nx-logo">nx</span>
          <span className="nx-title">nx-kv</span>
          <span className="nx-ver">面板 v2</span>
          <span className="grow" />
          <button
            className="iconbtn" title="设置" aria-label="设置"
            onClick={(e) =>
              setMenu({
                x: e.clientX, y: e.clientY,
                items: cfgMenuItems({ prefs, patchPrefs, onNavigate, onTplManage: () => onNavigate('#/templates') }),
              })
            }
          >
            <Icon name="gear" size={15} />
          </button>
          <button className="btn ghost sm" title="开一块新面板" onClick={() => setDrawer({ dock: 'center' })}>
            ＋ 面板
          </button>
          <button className="btn ghost sm" title="撤销上一次布局操作" disabled={!canUndo} onClick={undo}>
            ↶
          </button>
          <button className="btn ghost sm" title="重做" disabled={!canRedo} onClick={redo}>
            ↷
          </button>
          <button className="btn ghost sm" title="丢掉存下来的布局，回到初始的两栏" onClick={resetLayout}>
            重置布局
          </button>
        </header>

        {/* 工作区：面板可拖拽 / 拆分 / 浮出 */}
        <div className="nx-workarea">
          {model ? (
            <ErrorBoundary key="workspace">
              <Layout
                ref={layoutRef}
                model={model}
                factory={factory}
                onAction={(action) => action}
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
                // 浮窗头部的拖拽手柄：库里只有「拖到隐形窄带」一条迁回路，几乎没有可用性。
                // 换成可见的图标按钮——点击直接停靠回主布局（拖拽能力保留，图标即手柄）。
                icons={{
                  dragToDock: (
                    <button
                      type="button"
                      className="flx-dockback"
                      title="迁回主布局（也可拖到面板边缘停靠）"
                      aria-label="迁回主布局"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); dockFloatBack(e); }}
                    >
                      <Icon name="dock" size={14} />
                    </button>
                  ),
                }}
              />
            </ErrorBoundary>
          ) : (
            <div className="pad muted">正在装载工作区…</div>
          )}
        </div>

        {/* 状态条：工作区概况 + 深链 */}
        <footer className="nx-status">
          <span>工作区：{stats.tabsets} 个面板组 · {stats.tabs} 个面板</span>
          {waitingCount > 0 && <span className="nx-wait">{waitingCount} 个 agent 等待回填</span>}
          {localErr && !localData && <span className="nx-err">本机队列读取失败：{localErr}</span>}
          <span className="grow" />
          <span className="mono">深链 {location.hash || '#/overview'}</span>
          <span className="mono">布局 → localStorage('{WORKSPACE_KEY}')</span>
        </footer>

        {/* 面板抽屉：选类型 + 选停靠位（FlexLayout 的 DockLocation 认的那五个值） */}
        {drawer ? (
          <div className="nx-drawer">
            <div className="hd">停靠位置</div>
            <div className="rowgap">
              {DOCKS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={'nx-chip' + (drawer.dock === id ? ' on' : '')}
                  onClick={() => setDrawer((d) => ({ ...d, dock: id }))}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="sep" />
            <div className="hd">面板</div>
            {PANEL_ORDER.map((id) => (
              <button key={id} type="button" className="it" onClick={() => openFromDrawer(id)}>
                {PANELS[id].title}
              </button>
            ))}
            <div className="sep" />
            <button type="button" className="it" onClick={() => setDrawer(null)}>关闭</button>
          </div>
        ) : null}

        {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      </div>
    </AppContext.Provider>
  );
}
