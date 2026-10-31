// 侧栏作为**工作区面板**：它可拖拽、可拆分、可拖出成浮窗（与 nx-sk 同一套模型）。
//
// 收起态（窄轨）由**面板宽度**驱动：拖窄了就变 rail，点一下展开。
// 折叠动作 = 改 tabset 的 weight + 关掉页签条（39px 宽的 tabset 挤不下页签条，
// 残字比空白更难看）。两个属性都进布局，刷新后保持。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { useApp } from '../../app-context.jsx';
import { setTabsetAttrs, tabsetOfComponent } from '../../workspace.js';
import Sidebar from './index.jsx';

const COLLAPSE_AT = 46;   // 低于这个宽度 = 窄轨
const W_COLLAPSED = 2.5;  // 收起时的 tabset weight
const W_EXPANDED = 16;    // 展开时的 tabset weight（与初始布局一致）

export default function SidebarPanel() {
  const app = useApp() || {};
  const { model } = app;
  const hostRef = useRef(null);
  const [w, setW] = useState(null);

  // 两种状态共用一个**稳定宿主**：ResizeObserver 观察它——状态切换会换掉内层 DOM，
  // 但宿主不变，宽度测量不会断（否则收起后再展开会卡在窄轨）。
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof window.ResizeObserver === 'undefined') return undefined;
    const ro = new window.ResizeObserver((entries) => {
      for (const e of entries) setW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = w !== null && w < COLLAPSE_AT;

  const setSidebarState = useCallback((isCollapsed) => {
    if (!model) return;
    const tsId = tabsetOfComponent(model, 'sidebar');
    if (tsId) {
      setTabsetAttrs(model, tsId, {
        weight: isCollapsed ? W_COLLAPSED : W_EXPANDED,
        enableTabStrip: !isCollapsed,
      });
    }
  }, [model]);

  const collapse = useCallback(() => setSidebarState(true), [setSidebarState]);
  const expand = useCallback(() => setSidebarState(false), [setSidebarState]);

  // 拖拽触发的收起/展开也要落到模型——只在**翻转**时生效：
  // 挂载即设会把用户拖好的宽度冲掉。
  const prev = useRef(null);
  useEffect(() => {
    if (prev.current === null) { prev.current = collapsed; return; }
    if (prev.current === collapsed) return;
    prev.current = collapsed;
    setSidebarState(collapsed);
  }, [collapsed]);

  if (collapsed) {
    return (
      <div ref={hostRef} className="nx-rail-host">
        <button className="nx-rail" title="展开目录" aria-label="展开目录" onClick={expand}>
          <span className="nx-rail-btn" aria-hidden>»</span>
          <span className="nx-rail-label">目录</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="nx-side-host">
      <Sidebar
        repos={app.repoData ? app.repoData.repos : []}
        boards={app.repoData ? app.repoData.boards : []}
        topics={app.rows || []}
        route={app.route}
        onNavigate={app.onNavigate}
        refreshLocal={app.refreshLocal}
        refreshRepos={app.refreshRepos}
        prefs={app.prefs}
        patchPrefs={app.patchPrefs}
        onCollapse={collapse}
      />
    </div>
  );
}

/** 窄轨上的目录入口（折叠时仍能跳到目录） */
export function RailEntry({ icon = 'folder', label, onClick, badge }) {
  return (
    <button className="nx-rail-item" title={label} onClick={onClick}>
      <Icon name={icon} size={15} />
      {badge > 0 && <span className="b">{badge}</span>}
    </button>
  );
}
