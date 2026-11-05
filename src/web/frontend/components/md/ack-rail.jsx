// 任务页的「ack 定位轨」——反复 ack 反馈的长任务页里，一键跳到某一轮。
//
// 复用的是简介页那套定位轨（components/Introduction/rail.jsx 的 .doc-rail 视觉），
// 但**定位方式不同**：简介页按标题锚点跳，本轨按**块序号**跳。
// 原因见 modules/board/ack-nodes.js 的注释——实时预览态逐块渲染，同名标题在 DOM 里
// 拿到的是重复的同一个 id，按 id 跳永远落在第一轮；块序号（data-i）才唯一。
//
// 两种渲染态都要能用：
//   - 实时预览（.mdw-lp）：块有 data-i，按序号直接取
//   - 阅读态（.mdw-preview）：整篇一次性渲染，没有块元素，按「第 N 个 ack 标题」取
//
// 轨可拖动（任务 #55）：汉堡钮是拖把——按住拖整条轨（Pointer Events，>4px 算拖、
// 否则算点击），双击回默认钉位；落点经 modules/board/ack-rail-pos.js 钳制并
// 存 localStorage，重开面板还在。拖动语义只在任务页这层加，简介页轨不受影响。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ackNodeTitle } from '../../modules/board/ack-nodes.js';
import { clampRailPos, loadRailPos, saveRailPos } from '../../modules/board/ack-rail-pos.js';

// 位移阈值：超过才算拖动（否则 pointerup 后的 click 照常展开/收起）
const DRAG_THRESHOLD = 4;

/**
 * 在滚动容器里按块序号找到目标块。
 *
 * 两种渲染态的 DOM 形状不同：
 *   - 实时预览（.mdw-lp）：每块一个 .mdw-lp-block，带 data-i → 直接取
 *   - 阅读态（.mdw-preview）：整篇一次性渲染成一段 HTML，**没有块元素**；
 *     此时改用「第 N 个 ack 标题元素」定位（同名标题在阅读态是整篇共享 usedIds，
 *     id 各不相同，所以能按序号取到）
 *
 * @param {Element|null} root 滚动容器
 * @param {number} idx 块序号
 * @param {number} ackOrdinal 该轮是第几个 ack（0 基；阅读态按标题序号取）
 * @returns {Element|null}
 */
function blockAt(root, idx, ackOrdinal) {
  if (!root || idx < 0) return null;
  // 实时预览：每块带 data-i
  const live = root.querySelector(`.mdw-lp-block[data-i="${idx}"]`);
  if (live) return live;
  // 阅读态：整篇渲染 → 按「第 N 个 ack 标题」取
  const heads = [...root.querySelectorAll('h2')].filter(
    (h) => (h.textContent || '').trim() === '上一轮完成总结'
  );
  if (heads[ackOrdinal]) return heads[ackOrdinal];
  return null;
}

/**
 * @param {{nodes: {round:number, blockIndex:number, feedbackBlockIndex:number, ackText:string}[],
 *            scrollRoot: Element|null,
 *            onJump?: (node:object)=>void}} props
 */
export default function AckRail({ nodes = [], scrollRoot = null, onJump = null }) {
  const [open, setOpen] = useState(false);
  const [activeRound, setActiveRound] = useState(0);
  // 拖动落点：null = 默认钉位（CSS）；有值 = inline left/top 自由落点
  const [pos, setPos] = useState(loadRailPos);
  const [dragging, setDragging] = useState(false);
  const railRef = useRef(null);
  const dragRef = useRef(null); // 拖动会话：起点、容器/轨尺寸、是否已过阈值、最终落点
  const draggedRef = useRef(false); // 刚结束的是拖动 → 吃掉紧随的 click，别误触展开

  // 持久化落点钳回当前容器内（视口可能比上次拖动时小）
  useEffect(() => {
    const el = railRef.current;
    const parent = el && el.parentElement;
    if (!el || !parent) return undefined;
    const fix = () => {
      // 经 setPos updater 读最新落点(不另设 ref);钳制是纯函数,重复调用幂等
      setPos((cur) => {
        if (!cur) return cur;
        const pr = parent.getBoundingClientRect();
        const rr = el.getBoundingClientRect();
        const fixed = clampRailPos({
          x: cur.x, y: cur.y, parentW: pr.width, parentH: pr.height, railW: rr.width, railH: rr.height,
        });
        return fixed && (fixed.x !== cur.x || fixed.y !== cur.y) ? fixed : cur;
      });
    };
    fix();
    // 窗口缩放时也别出界
    window.addEventListener('resize', fix, { passive: true });
    return () => window.removeEventListener('resize', fix);
  }, []);

  // ─── 拖动（汉堡钮 = 拖把）────────────────────────────────────────
  const beginDrag = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = railRef.current;
    const parent = el && el.parentElement;
    if (!el || !parent) return;
    // 钉位态盒子被 top/bottom 双锚拉满（bottom:44 → 高 760），实测高 ≠ 拖后自由态
    // 自然高——拿它钳制会把上限错钳到容器顶部（第一次拖只能落在 y≤132）。
    // 临时解除底锚量一次自然高再恢复：同帧同步、子元素本来就从顶部堆叠，无视觉跳动。
    const prevBottom = el.style.bottom;
    el.style.bottom = 'auto';
    const rr = el.getBoundingClientRect();
    if (prevBottom) el.style.bottom = prevBottom;
    else el.style.bottom = '';
    const pr = parent.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rr.left - pr.left, // 轨在容器内的当前左/上（含钉位态）——位移在此基础上叠加
      startTop: rr.top - pr.top,
      parentW: pr.width,
      parentH: pr.height,
      railW: rr.width,
      railH: rr.height, // 自然高（已解除底锚量取）
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 老浏览器不支持捕获时照常工作（指针没离开按钮的话） */
    }
  }, []);

  const onDragMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      draggedRef.current = true;
      setDragging(true);
      document.body.style.userSelect = 'none'; // 拖动别顺带选中正文
    }
    // 抓握点跟随手指：轨在容器内的落点 = 指针按下时的轨位置 + 指针位移
    //（startLeft 按下时实测，grabDX 的偏移天然已含在内，不需要再修正）
    const fixed = clampRailPos({
      x: d.startLeft + dx,
      y: d.startTop + dy,
      parentW: d.parentW,
      parentH: d.parentH,
      railW: d.railW,
      railH: d.railH,
    });
    if (fixed) {
      d.last = fixed; // 最终落点记在会话里——pointerup 直接取，不等 React 提交
      setPos(fixed);
    }
  }, []);

  const endDrag = useCallback((e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return; // 没过阈值 = 点击，交给 onClick 展开/收起
    setDragging(false);
    document.body.style.userSelect = '';
    saveRailPos(d.last); // 拖完落点才存（拖动过程不写盘；存会话里的最终落点，不读可能未提交的 state）
  }, []);

  const resetPos = useCallback(() => {
    setPos(null);
    saveRailPos(null); // 清记录 = 回 CSS 默认钉位
  }, []);

  const items = useMemo(() => (nodes || []).map((n) => ({ ...n, title: ackNodeTitle(n) })), [nodes]);

  // 当前视口里最近的一个 ack 段 → 高亮对应节点
  useEffect(() => {
    const root = scrollRoot;
    if (!root || !items.length) return undefined;
    const sync = () => {
      const rootRect = root.getBoundingClientRect();
      let cur = 0;
      for (const it of items) {
        const el = blockAt(root, it.blockIndex, it.round - 1);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top - rootRect.top <= 40) cur = it.round;
      }
      setActiveRound(cur);
    };
    sync();
    root.addEventListener('scroll', sync, { passive: true });
    return () => root.removeEventListener('scroll', sync);
  }, [scrollRoot, items]);

  const jump = useCallback(
    (node) => {
      const root = scrollRoot;
      const el = root ? blockAt(root, node.blockIndex, node.round - 1) : null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveRound(node.round);
      }
      onJump?.(node);
    },
    [scrollRoot, onJump]
  );

  if (!items.length) return null;

  return (
    <aside
      ref={railRef}
      className={'doc-rail ack-rail' + (open ? ' open' : '') + (dragging ? ' dragging' : '')}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      aria-label="验收轮次"
    >
      <button
        type="button"
        className="doc-rail-menu"
        title={open ? '收起轮次（双击回默认位）' : '展开轮次 · 按住拖动 · 双击回默认位'}
        aria-expanded={open}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false; // 这下 click 是拖动结束带出来的，别当点击
            return;
          }
          setOpen((v) => !v);
        }}
        onPointerDown={beginDrag}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetPos}
      >
        <span /><span /><span />
      </button>

      <div className="doc-rail-ticks" role="navigation" aria-label="验收轮次">
        {items.map((it) => (
          <button
            key={it.round}
            type="button"
            className={'doc-rail-tick' + (activeRound === it.round ? ' on' : '')}
            style={{ '--tw': '18px' }}
            title={it.title}
            aria-current={activeRound === it.round ? 'true' : undefined}
            onClick={() => jump(it)}
          />
        ))}
      </div>

      {open && (
        <div className="doc-rail-panel">
          <div className="doc-rail-sec">
            <div className="doc-rail-sec-lab">验收轮次</div>
            {items.map((it) => (
              <button
                key={it.round}
                type="button"
                className={'doc-rail-row' + (activeRound === it.round ? ' on' : '')}
                title={it.ackText}
                onClick={() => jump(it)}
              >
                第 {it.round} 轮
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
