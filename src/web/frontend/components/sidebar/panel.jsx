// 侧栏作为**工作区面板**：它可拖拽、可拆分、可拖出成浮窗（与 nx-sk 同一套模型）。
//
// 收起态（窄轨）是**显式状态**，宽度只是它的一路驱动信号（拖窄自动收起 / 拖宽自动展开）。
// 旧实现拿「绝对像素 < 46」当判定，而收起宽度是 tabset weight 的**比例**（2.5%）——
// 宽窗口下 2.5% 折算出来比 46px 还宽，判定永远不翻转，侧栏卡在「压窄的展开态」
// （todo 里「展开收起仍然存在是问题」的真相）。现在：
//   - 点击收起/展开 → 直接翻状态，落模型（weight + enableTabStrip 进布局，刷新保持）
//   - 拖拽 → 迟滞带：宽度 < COLLAPSE_AT 收起；≥ EXPAND_AT 展开；中间保持现状（防抖）
//   - 首屏 → 按 localStorage 布局里的 weight 判（收起态刷新后还是窄轨）
//
// 顶栏删掉后全局动作都在侧栏头部；**窄轨也要保住设置入口**（齿轮）——
// 否则收起侧栏 = 摸不到设置。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { useApp } from '../../app-context.jsx';
import { setTabsetAttrs, tabsetOfComponent } from '../../workspace.js';
import Sidebar from './index.jsx';

const COLLAPSE_AT = 46;   // 拖窄到这个宽度以下 = 自动收起
const EXPAND_AT = 120;    // 拖宽到这个宽度以上 = 自动展开；46~120 之间 = 迟滞带（保持现状，防抖）
const W_COLLAPSED = 2.5;  // 收起时的 tabset weight
const W_EXPANDED = 16;    // 展开时的 tabset weight（与初始布局一致）

// 首屏判定：布局存的是收起态（weight 2.5）时，第一帧就该是窄轨。
// weight 用比例读（<8 视为收起档），与像素无关。
function initialCollapsed(model) {
  const tsId = model && tabsetOfComponent(model, 'sidebar');
  if (!tsId) return false;
  const ts = model.getNodeById ? model.getNodeById(tsId) : null;
  const weight = ts ? (typeof ts.getWeight === 'function' ? ts.getWeight() : Number(ts.getAttributes()?.weight) || 0) : 0;
  return weight > 0 && weight < 8;
}

export default function SidebarPanel() {
  const app = useApp() || {};
  const { model } = app;
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(model));

  // 宿主元素用 **ref 回调 + state** 拿：展开/收起两个分支是两个不同的 div，
  // 切换分支时旧元素卸载、新元素挂载——只在挂载时 observe 一次的老写法会在
  // 第一次切换后失去观察，宽度变化从此失联（实测踩过）。
  const [hostEl, setHostEl] = useState(null);
  const attachHost = useCallback((el) => setHostEl(el), []);

  // 宽度信号 → 迟滞判定：<46 收起 / ≥120 展开 / 中间保持现状。
  // 点击路径不受影响：点击直接翻状态，收起后的宽度（2.5%）落在迟滞带里不会反弹。
  useEffect(() => {
    if (!hostEl || typeof window.ResizeObserver === 'undefined') return undefined;
    const ro = new window.ResizeObserver((entries) => {
      for (const e of entries) {
        const px = Math.round(e.contentRect.width);
        setCollapsed((cur) => (px < COLLAPSE_AT ? true : px >= EXPAND_AT ? false : cur));
      }
    });
    ro.observe(hostEl);
    return () => ro.disconnect();
  }, [hostEl]);

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

  const collapse = useCallback(() => setCollapsed(true), []);
  const expand = useCallback(() => setCollapsed(false), []);

  // 状态翻转统一在这里落模型（点击 / 拖拽迟滞 / 初始都不例外）；
  // 只在**翻转**时生效——挂载即设会把用户拖好的宽度冲掉。
  const prev = useRef(null);
  useEffect(() => {
    if (prev.current === null) { prev.current = collapsed; return; }
    if (prev.current === collapsed) return;
    prev.current = collapsed;
    setSidebarState(collapsed);
  }, [collapsed, setSidebarState]);

  if (collapsed) {
    return (
      <div ref={attachHost} className="nx-rail-host">
        <button className="nx-rail" title="展开目录" aria-label="展开目录" onClick={expand}>
          <span className="nx-rail-btn" aria-hidden>»</span>
          <span className="nx-rail-label">目录</span>
        </button>
        <div className="nx-rail-acts">
          <button
            className="nx-rail-act" title="设置（浮动面板）" aria-label="设置"
            onClick={() => app.shell && app.shell.openSettings()}
          >
            <Icon name="gear" size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={attachHost} className="nx-side-host">
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
        shell={app.shell}
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
