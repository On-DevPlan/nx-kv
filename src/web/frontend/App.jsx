// 应用壳：顶栏 + tab 导航（注册表驱动）+ hash 路由。
// 路由即持久化：当前视图写进 location.hash 与 store，刷新/分享链接都停在原页面。
import { Suspense, useEffect } from 'react';
import { useStore } from './store.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import { VIEWS } from './registry.js';
import { api } from './api/client.js';

function viewFromHash() {
  // hash 形如 `#/localtask?key=xxx&cwd=yyy`——**查询参数必须先剥掉**再比对视图 id。
  // 以前整条 hash 拿去比：带 query 必然对不上任何一个 view id → wait 打开的深链
  // 根本不会切到「本地任务」页，用户等半天看到一个不相干的页面。
  const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return VIEWS.some((v) => v.id === h) ? h : '';
}

export default function App() {
  const { boot, ui, patchUi } = useStore();

  // 初始进入：hash 优先，否则用持久化的上次视图
  useEffect(() => {
    const fromHash = viewFromHash();
    if (fromHash && fromHash !== ui.view) patchUi({ view: fromHash });
    else if (!location.hash) location.hash = '#/' + ui.view;
    // 只在挂载时对齐一次：后续 hash 变化由下面的 hashchange 监听接管
  }, []);

  // hash 变化（浏览器前进后退）→ 同步 store
  useEffect(() => {
    const onHash = () => {
      const v = viewFromHash();
      if (v) patchUi({ view: v });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [patchUi]);

  // 心跳：每 15s 打一次 /api/ping。
  // 目的不是健康检查，而是给 serve --auto-exit 上报「面板还开着」。
  // 单视图挂载（current.component）切到任意页面都算「开着」，
  // 不用 SSE 数连接来判——切页会断 SSE，但页面明明还开着。
  useEffect(() => {
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      api('/api/ping').catch(() => {});
    };
    beat();
    const t = setInterval(beat, 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const current = VIEWS.find((v) => v.id === ui.view) || VIEWS[0];

  const switchTo = (id) => {
    patchUi({ view: id });
    location.hash = '#/' + id;
  };

  return (
    <>
      <header>
        <div className="brand">
          <img src="/logo-rounded.png" alt="nx-kv" />
          nx-kv
          {/* 原来这里又写死了一个 "nx-kv"，顶栏永远显示「nx-kv nx-kv」——
              纯重复。改成版本号：它本来就是 app 版本，现在放在了该在的位置。 */}
          <span className="sub">v{boot?.version || ''}</span>
        </div>
        <nav>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={'tab' + (v.id === current.id ? ' active' : '')}
              onClick={() => switchTo(v.id)}
            >
              {v.title}
            </button>
          ))}
        </nav>
        {/* 之前这里读的是 boot.storePath —— 但 bootstrap 响应里**根本没有这个字段**
            （只有 configPath），所以这一格永远是空的。换成真正存在的 configPath：
            用户能看到「我现在连的是哪个本地配置」。 */}
        <div className="meta" title={boot?.configPath || ''}>
          {boot?.configPath ? '本地配置 ' + boot.configPath : ''}
        </div>
      </header>

      <main>
        {/* 边界放在 Suspense 外层：懒加载 chunk 拉取失败也由它接管，
            否则一个视图崩掉就是整页白屏 */}
        <ErrorBoundary key={current.id}>
          <Suspense fallback={<div className="muted" style={{ padding: 24 }}>加载中…</div>}>
            <section className="panel active"><current.component /></section>
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer>
        面板上每个按钮都有同构 CLI 命令（见各页底部提示）· <code>nx-kv help</code> · agent 可加 <code>--json</code> 获取机器可读输出
      </footer>
    </>
  );
}
