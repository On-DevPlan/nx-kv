// 右侧定位轨的「拖动」（任务 #55 起，2026-11-12 抽公共）。
//
// 语义（两条轨一致）：
//   · 汉堡钮 = 拖把：按住拖动整条轨，>4px 才算拖（否则 pointerup 后的 click 照常展开/收起）；
//   · 落点钳在容器内（clampRailPos），松手才写 localStorage；
//   · 双击回默认钉位（清记录 = 回 CSS 的 right/top/bottom）。
//
// 为什么抽出来：文档页的目录轨（components/Introduction/rail.tsx）此前没有拖动，
// 用户点了汉堡钮「无法拖动」——它和任务页 ack 轨（components/md/ack-rail.tsx）
// 是同一套 `.doc-rail` 视觉，拖动行为不该只长在一边。两处共用这一份，
// 语义漂移就无从发生。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { clampRailPos, loadRailPos, saveRailPos } from '../modules/board/ack-rail-pos.js';
import type { RailPos } from '../modules/board/ack-rail-pos.js';

// 位移阈值：超过才算拖动（否则 pointerup 后的 click 照常展开/收起）
const DRAG_THRESHOLD = 4;

/** 一次拖动会话：起点、容器/轨尺寸、是否已过阈值、最终落点。 */
interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  parentW: number;
  parentH: number;
  railW: number;
  railH: number;
  moved: boolean;
  last?: RailPos | null;
}

/** 绑到汉堡钮上的事件集（与 <button> 的 props 同名，直接展开即可）。 */
export interface RailDragHandleProps {
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
}

export interface RailDragState {
  /** 挂到 <aside> 上（hook 靠它量尺寸、钳落点） */
  railRef: RefObject<HTMLElement | null>;
  /** null = 默认钉位（CSS）；有值 = inline left/top 自由落点 */
  pos: RailPos | null;
  dragging: boolean;
  /** 刚结束的是拖动 → click 处理里先吃掉一次，别误触展开 */
  draggedRef: RefObject<boolean>;
  /** 双击：清记录回默认钉位 */
  resetPos: () => void;
  handleProps: RailDragHandleProps;
}

/**
 * @param storageKey 落点持久化的键（不同轨各记各的；缺省 = 任务页 ack 轨）
 */
export function useRailDrag(storageKey?: string): RailDragState {
  const [pos, setPos] = useState<RailPos | null>(() => loadRailPos(storageKey));
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const draggedRef = useRef(false);

  // 持久化落点钳回当前容器内（视口可能比上次拖动时小）
  useEffect(() => {
    const el = railRef.current;
    const parent = el && el.parentElement;
    if (!el || !parent) return undefined;
    const fix = () => {
      // 经 setPos updater 读最新落点（不另设 ref）；钳制是纯函数，重复调用幂等
      setPos((cur) => {
        if (!cur) return cur;
        const pr = parent.getBoundingClientRect();
        const rr = el.getBoundingClientRect();
        const fixed: RailPos | null = clampRailPos({
          x: cur.x, y: cur.y, parentW: pr.width, parentH: pr.height, railW: rr.width, railH: rr.height,
        });
        return fixed && (fixed.x !== cur.x || fixed.y !== cur.y) ? fixed : cur;
      });
    };
    fix();
    window.addEventListener('resize', fix, { passive: true });
    return () => window.removeEventListener('resize', fix);
  }, []);

  const beginDrag = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = railRef.current;
    const parent = el && el.parentElement;
    if (!el || !parent) return;
    // 钉位态盒子被 top/bottom 双锚拉满（如 bottom:44 → 高 760），实测高 ≠ 拖后自由态
    // 自然高——拿它钳制会把上限错钳到容器顶部（第一次拖只能落在 y≤132）。
    // 临时解除底锚量一次自然高再恢复：同帧同步、子元素本来就从顶部堆叠，无视觉跳动。
    const prevBottom = el.style.bottom;
    el.style.bottom = 'auto';
    const rr = el.getBoundingClientRect();
    el.style.bottom = prevBottom || '';
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

  const onDragMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
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
    const fixed: RailPos | null = clampRailPos({
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

  const endDrag = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return; // 没过阈值 = 点击，交给 onClick 展开/收起
    setDragging(false);
    document.body.style.userSelect = '';
    saveRailPos(d.last, storageKey); // 拖完落点才存（存会话里的最终落点，不读可能未提交的 state）
  }, [storageKey]);

  const resetPos = useCallback(() => {
    setPos(null);
    saveRailPos(null, storageKey); // 清记录 = 回 CSS 默认钉位
  }, [storageKey]);

  return {
    railRef,
    pos,
    dragging,
    draggedRef,
    resetPos,
    handleProps: {
      onPointerDown: beginDrag,
      onPointerMove: onDragMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: resetPos,
    },
  };
}
