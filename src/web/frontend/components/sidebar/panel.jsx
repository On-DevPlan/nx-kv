// 侧栏作为**工作区面板**：它可拖拽、可拆分、可拖出成浮窗（与 nx-sk 同一套模型）。
//
// 三态（见 side-state.js）：expanded 展开宽度 / collapsed 窄轨 / closed 完全隐藏。
// 收起态（窄轨）与关闭态都是**显式状态**，宽度只是它的一路驱动信号
// （拖窄自动收起 / 拖宽自动展开）。旧实现拿「绝对像素 < 46」当判定，而收起宽度是
// tabset weight 的**比例**（2.5%）——宽窗口下 2.5% 折算出来比 46px 还宽，判定永远
// 不翻转，侧栏卡在「压窄的展开态」。现在：
//   - 点击收起/展开/关闭 → 直接翻状态，落模型（weight + enableTabStrip 进布局，刷新保持）
//   - 拖拽 → 迟滞带：宽度 < COLLAPSE_AT 收起；≥ EXPAND_AT 展开；中间保持现状（防抖）
//   - 关闭态例外：只有 ≥ EXPAND_AT 才翻回展开——把手被拖一下不该变成窄轨
//   - 首屏 → 按布局里的 weight 分档（closed/collapsed/expanded，见 classifySideState）
//
// 顶栏删掉后全局动作都在侧栏头部；**窄轨与关闭态也要保住设置入口**（齿轮）——
// 否则收起/关闭侧栏 = 摸不到设置。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { useApp } from '../../app-context.jsx';
import { setTabsetAttrs, tabsetOfComponent } from '../../workspace.js';
import { classifySideState, sideStateAttrs } from './side-state.js';
import Sidebar from './index.jsx';

const COLLAPSE_AT = 46;   // 拖窄到这个宽度以下 = 自动收起
const EXPAND_AT = 120;    // 拖宽到这个宽度以上 = 自动展开；46~120 之间 = 迟滞带（保持现状，防抖）

// 首屏判定：布局存的是哪一档，第一帧就该是哪一态。weight 用比例读，与像素无关。
function initialSideState(model) {
  const tsId = model && tabsetOfComponent(model, 'sidebar');
  if (!tsId) return 'expanded';
  const ts = model.getNodeById ? model.getNodeById(tsId) : null;
  const weight = ts ? (typeof ts.getWeight === 'function' ? ts.getWeight() : Number(ts.getAttributes()?.weight) || 0) : 0;
  return classifySideState(weight);
}

export default function SidebarPanel() {
  const app = useApp() || {};
  const { model } = app;
  const [state, setState] = useState(() => initialSideState(model));

  // 宿主元素用 **ref 回调 + state** 拿：三个分支是三个不同的 div，
  // 切换分支时旧元素卸载、新元素挂载——只在挂载时 observe 一次的老写法会在
  // 第一次切换后失去观察，宽度变化从此失联（实测踩过）。
  const [hostEl, setHostEl] = useState(null);
  const attachHost = useCallback((el) => setHostEl(el), []);

  // 点击关闭/展开时：React 状态先变，FlexLayout weight 后到——中间那几帧宿主
  // 还是旧宽度。ResizeObserver 若按像素改状态，会把「刚关闭」误判成「该展开」
  // （closed + 旧宽度 ≥120 → 弹回 expanded），再被收成窄轨，看起来像卡死。
  // lock 在程序化切换期间按目标态钉住，忽略互相矛盾的宽度信号。
  const lock = useRef(null); // { state, until } | null

  const setSidebarState = useCallback((next) => {
    if (!model) return;
    const tsId = tabsetOfComponent(model, 'sidebar');
    if (tsId) setTabsetAttrs(model, tsId, sideStateAttrs(next));
  }, [model]);

  const program = useCallback((next) => {
    lock.current = { state: next, until: Date.now() + 600 };
    // 先落 weight，再切 React 态——避免「UI 已是 closed、宿主仍是展开宽」那几帧
    setSidebarState(next);
    setState(next);
  }, [setSidebarState]);

  const collapse = useCallback(() => program('collapsed'), [program]);
  const expand = useCallback(() => program('expanded'), [program]);
  const close = useCallback(() => program('closed'), [program]);

  // 宽度信号 → 迟滞判定：<46 收起 / ≥120 展开 / 中间保持现状。
  // 关闭态不靠宿主像素自动展开（关闭瞬间宿主仍可能是展开宽度）——
  // 出口只有：点半圆弧把手，或用户拖分隔条把 weight 拉过阈值（见下）。
  useEffect(() => {
    if (!hostEl || typeof window.ResizeObserver === 'undefined') return undefined;
    const ro = new window.ResizeObserver((entries) => {
      for (const e of entries) {
        const px = Math.round(e.contentRect.width);
        setState((cur) => {
          const L = lock.current;
          if (L) {
            if (Date.now() > L.until) {
              lock.current = null;
            } else if (L.state === 'closed') {
              // 钉住关闭；只有分隔条真把区域拖宽了才解除（weight 已变大）
              return 'closed';
            } else if (L.state === 'expanded') {
              if (px >= EXPAND_AT) lock.current = null;
              return 'expanded';
            } else if (L.state === 'collapsed') {
              if (px < COLLAPSE_AT) lock.current = null;
              return 'collapsed';
            }
          }
          // 关闭态：不因宿主像素自动展开（防关闭瞬间旧宽度误触发）
          if (cur === 'closed') return cur;
          return px < COLLAPSE_AT ? 'collapsed' : px >= EXPAND_AT ? 'expanded' : cur;
        });
      }
    });
    ro.observe(hostEl);
    return () => ro.disconnect();
  }, [hostEl]);

  // 关闭态下拖分隔条：weight 过阈值时才翻回展开（不读宿主像素，避开旧宽度坑）
  useEffect(() => {
    if (state !== 'closed' || !model) return undefined;
    const tick = () => {
      const tsId = tabsetOfComponent(model, 'sidebar');
      const ts = tsId && model.getNodeById ? model.getNodeById(tsId) : null;
      const w = ts ? (typeof ts.getWeight === 'function' ? ts.getWeight() : Number(ts.getAttributes()?.weight) || 0) : 0;
      if (classifySideState(w) === 'expanded') {
        lock.current = null;
        setState('expanded');
      }
    };
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [state, model]);

  // 状态翻转统一在这里落模型（点击 / 拖拽迟滞 / 初始都不例外）；
  // 只在**翻转**时生效——挂载即设会把用户拖好的宽度冲掉。
  const prev = useRef(null);
  useEffect(() => {
    if (prev.current === null) { prev.current = state; return; }
    if (prev.current === state) return;
    prev.current = state;
    setSidebarState(state);
  }, [state, setSidebarState]);

  // 关闭态给 body 打标：样式层把左侧 tabset 的纸色占位压掉（把手已 portal 出去）。
  useEffect(() => {
    document.body.classList.toggle('nx-side-is-closed', state === 'closed');
    return () => document.body.classList.remove('nx-side-is-closed');
  }, [state]);

  if (state === 'closed') {
    // 关闭态：tabset 只留极窄占位。展开把手改由 App 壳层的 SidebarRescueFab 负责
    // （挂 document.body）——weight 被拖到近 0 时本组件可能根本不挂载，把手不能跟着死。
    return <div ref={attachHost} className="nx-side-closed-host" aria-hidden />;
  }

  if (state === 'collapsed') {
    return (
      <div ref={attachHost} className="nx-rail-host">
        <button className="nx-rail" title="展开目录" aria-label="展开目录" onClick={expand}>
          <span className="nx-rail-btn" aria-hidden>»</span>
          <span className="nx-rail-label">目录</span>
        </button>
        <div className="nx-rail-acts">
          {/* 布局撤销/恢复已下线（#96）；窄轨保留关闭与设置入口——
              「收起侧栏 = 摸不到设置」与齿轮同一类缺口，全局动作收口在侧栏。 */}
          <button
            className="nx-rail-act" title="关闭目录（完全隐藏，左缘把手可展开）" aria-label="关闭目录"
            onClick={close}
          >
            <Icon name="x" size={14} />
          </button>
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
        onClose={close}
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
