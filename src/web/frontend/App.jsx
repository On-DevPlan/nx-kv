// 应用壳 v2（原型 plan/uiux-redesign.html §1/§2）：侧边栏 + 主区，替换「顶栏 + 平铺 tab」。
// 目录（topic）提升为一级导航；hash 路由：
//   #/dir/<key>  目录详情    #/global  全局任务池   #/overview  全部目录总览
//   #/cloud      云端总览    #/repos   仓库管理
//   （经典看板 #/localtask 已下线；wait 深链改落 #/dir/<key>；
//     登录已合并进云端页，独立 #/auth 页已下线）
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from './store.jsx';
import { ErrorBoundary, useToast } from './components/ui.jsx';
import { VIEWS } from './registry.js';
import { api } from './api/client.js';
import { Icon } from './components/icons.jsx';
import Sidebar from './components/sidebar/index.jsx';
import { loadPrefs, updatePrefs } from './prefs.js';
import { SideResizer, useSideWidth } from './components/layout/side-resizer.jsx';

// hash → 路由对象。带 query 的 #/dir/<key>?task=… 是页面深链，交给 MD 工作台。
function routeFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const path = h.split('?')[0];
  if (path.startsWith('dir/')) {
    return { view: 'dir', key: decodeURIComponent(path.slice(4)) };
  }
  const KNOWN = ['global', 'overview', 'cloud', 'todo', 'repos'];
  if (KNOWN.includes(path)) return { view: path === 'todo' ? 'cloud' : path };
  // 旧深链（#/localtask?…）与未知路径统一落总览
  return { view: 'overview' };
}

export default function App() {
  const { boot } = useStore();
  const toast = useToast();
  const [route, setRoute] = useState(routeFromHash);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [waitingCount, setWaitingCount] = useState(0);
  const [localData, setLocalData] = useState(null); // /api/localtasks 结果
  const [localErr, setLocalErr] = useState('');
  const { sideW, beginDrag, onKeyDown: onSideKey, reset: resetSideW } = useSideWidth({
    disabled: prefs.folded,
  });

  const patchPrefs = useCallback((patch) => setPrefs(updatePrefs(patch)), []);

  // 首次访问且用户开了「默认收起」：进场即收起（此后 folded 自持久化接管）
  useEffect(() => {
    if (prefs.defaultFolded && !localStorage.getItem('nx-kv-sidebar-v1')) patchPrefs({ folded: true });
  }, []);

  // ─── 路由：hashchange 单向同步（navigate 就是写 hash）───
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // 初始 hash 为空时落一个默认路由，保证刷新/分享链接行为一致
  useEffect(() => {
    if (!location.hash) location.hash = '#/overview';
  }, []);

  const onNavigate = useCallback((hash) => {
    const prevPath = (location.hash || '').split('?')[0];
    const nextPath = hash.split('?')[0];
    if (location.hash === hash) setRoute(routeFromHash());
    else location.hash = hash;
    // 进入目录/全局详情时收起侧栏；同详情换任务（?task=）保持展开，便于点侧栏子行
    const isDetail = nextPath.startsWith('#/dir/') || nextPath === '#/global';
    const sameDetail = isDetail && prevPath === nextPath;
    const isTaskDeep = /[?&]task=/.test(hash);
    if (isDetail && !sameDetail && !isTaskDeep) {
      setPrefs((p) => (p.folded ? p : updatePrefs({ folded: true })));
    }
  }, []);

  // Esc：详情页返回总览（菜单/输入框打开时不劫持——菜单层已用捕获+stopPropagation）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (route.view === 'dir' || route.view === 'global') {
        location.hash = '#/overview';
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.view]);

  // ─── 本机队列数据：侧边栏与各视图共用一份（15s 轮询 + 操作后手动刷新）───
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

  // ─── 仓库与项目组：侧边栏的数据源（收纳组是纯显示层，存在 prefs 里）───
  // 侧边栏里的「资产」只有两种：项目（仓库登记）与项目组（看板）——并列，谁也不装谁。
  // 「收纳组」不在这里：它只是把资产摆在一起的格子，属于 prefs。
  const [repoData, setRepoData] = useState({ repos: [], boards: [] });
  const refreshRepos = useCallback(async () => {
    try {
      const [repos, boards] = await Promise.all([api('/api/repos'), api('/api/boards')]);
      setRepoData({
        repos: (repos || []).filter((r) => (r.type || 'dev') !== 'ref'), // 参考仓库不进侧边栏
        boards: (boards && boards.boards) || [],
      });
    } catch {
      /* 读失败：保留旧数据，侧边栏仍可用 */
    }
  }, []);
  useEffect(() => {
    refreshRepos();
    const t = setInterval(refreshRepos, 30_000);
    return () => clearInterval(t);
  }, [refreshRepos]);

  // ─── 等待回填提醒（沿用 v1：presence 轮询，用户停在任意页都要知道）───
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

  // 视图懒加载：路由 → 注册表条目
  const entry = VIEWS.find((v) => v.id === (route.view === 'global' ? 'global' : route.view));
  const ViewComponent = entry?.component;

  return (
    <div id="app-shell" data-route={route.view} style={{ '--side-w': `${sideW}px` }}>
      {prefs.folded ? (
        <Rail
          route={route} onNavigate={onNavigate} prefs={prefs} patchPrefs={patchPrefs}
          repos={repoData.repos} rows={rows} waitingCount={waitingCount}
        />
      ) : (
        <>
          {/* 窄屏（≤900px）侧栏浮层化后的点外收起遮罩；宽屏 display:none 不参与 */}
          <div className="side-scrim" onClick={() => patchPrefs({ folded: true })} aria-hidden="true" />
          <Sidebar
            repos={repoData.repos} boards={repoData.boards} topics={rows}
            route={route} onNavigate={onNavigate}
            boot={boot} waitingCount={waitingCount}
            prefs={prefs} patchPrefs={patchPrefs}
            refreshRepos={refreshRepos}
          />
        </>
      )}
      <SideResizer
        sideW={sideW}
        beginDrag={beginDrag}
        onKeyDown={onSideKey}
        reset={resetSideW}
        hidden={prefs.folded}
      />

      <main id="main">
        {localErr && !localData && (
          <div className="pane-error" style={{ height: '60%' }}>
            <span className="big"><Icon name="warn" size={28} /></span>
            <div className="tx">本机队列读取失败：{localErr}</div>
            <button className="btn ghost" onClick={refreshLocal}>重试</button>
          </div>
        )}
        <ErrorBoundary key={route.view + (route.key || '')}>
          <Suspense fallback={<div className="muted" style={{ padding: 24 }}>加载中…</div>}>
            {ViewComponent && route.view !== 'global' && (
              <ViewComponent
                dirKey={route.key}
                rows={rows}
                refreshLocal={refreshLocal}
                boot={boot}
                onNavigate={onNavigate}
              />
            )}
            {ViewComponent && route.view === 'global' && (
              <GlobalEntry rows={rows} refreshLocal={refreshLocal} boot={boot} onNavigate={onNavigate} />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

// 全局任务池与目录详情共用 MD 工作台（dirKey 空 = 全局池）
function GlobalEntry({ rows, refreshLocal, boot, onNavigate }) {
  const View = VIEWS.find((v) => v.id === 'global').component;
  return <View dirKey="" rows={rows} refreshLocal={refreshLocal} boot={boot} onNavigate={onNavigate} />;
}

// 收起态 rail：52px 图标条，悬停气泡显示名称，徽标仍在（原型 §2/§3）
function Rail({ route, onNavigate, patchPrefs, repos, rows, waitingCount }) {
  // 目录 = 仓库登记（与展开态同一份数据）；待领取数从队列按仓库汇总
  const pendingOf = new Map();
  const topicKeyOf = new Map();
  for (const t of rows) {
    if (t.isGlobal || !t.repo) continue;
    pendingOf.set(t.repo.id, (pendingOf.get(t.repo.id) || 0) + (t.pending || 0));
    if (!topicKeyOf.has(t.repo.id)) topicKeyOf.set(t.repo.id, t.key);
  }
  const dirs = (repos || []).slice(0, 9).map((r) => ({
    key: topicKeyOf.get(r.id) || r.key || r.id,
    name: r.name,
    pending: pendingOf.get(r.id) || 0,
    waiting: (rows || []).some((t) => t.repo && t.repo.id === r.id && t.waiting),
  }));
  const globalRow = rows.find((r) => r.isGlobal);
  const btn = (active, tip, onClick, icon, badge, dot, key) => (
    <button
      key={key || tip}
      className={'railbtn' + (active ? ' active' : '')}
      data-tip={tip}
      aria-label={tip}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      {badge > 0 && <span className="b">{badge}</span>}
      {dot && <span className="wdot" />}
    </button>
  );
  return (
    <nav id="rail" aria-label="侧边栏（收起态）">
      <button className="railbtn" data-tip="展开侧边栏" aria-label="展开侧边栏" onClick={() => patchPrefs({ folded: false })}>
        <Icon name="sidebar" size={16} />
      </button>
      <div className="rail-sep" />
      {globalRow && btn(route.view === 'global', '全局任务池', () => onNavigate('#/global'), 'globe', globalRow.pending, globalRow.waiting)}
      {dirs.map((d) =>
        btn(route.view === 'dir' && route.key === d.key, d.name, () => onNavigate('#/dir/' + encodeURIComponent(d.key)), 'folder', d.pending, d.waiting, d.key)
      )}
      <div className="rail-grow" />
      <div className="rail-sep" />
      {btn(route.view === 'overview', '全部目录总览', () => onNavigate('#/overview'), 'overview', waitingCount)}
      {btn(route.view === 'cloud', '云端总览', () => onNavigate('#/cloud'), 'cloud')}
      {btn(route.view === 'repos', '仓库管理', () => onNavigate('#/repos'), 'repo')}
    </nav>
  );
}
