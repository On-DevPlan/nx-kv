// 编排画布的指针交互：拖动节点（松手写回摆位）、拉线连边（命中检测 + 提交）。
//
// 监听装在 window 上（拖出画布也要跟手）；状态全部经 ref 注入——监听只挂一次，
// 读到的是各 ref 的 .current，始终是最新状态（空依赖闭包因此安全）。
import { useEffect } from 'react';
import { DRAG_THRESH, NODE_W, savePos } from './layout.js';
import { canvasPoint } from './edges.js';

export function useDagInteractions({
  canvasRef,
  modeRef,
  posRef,
  nodesRef,
  byNodeKeyRef,
  scopeKeyRef,
  userMovedRef,
  commitRef,
  toastRef,
  setPos,
  setDragId,
  setLinking,
}) {
  const hitNodeAt = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { x, y } = canvasPoint(canvas, clientX, clientY);
    const list = nodesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const nk = list[i].nodeKey;
      const p = posRef.current.get(nk);
      if (!p) continue;
      const el = canvas.querySelector(`[data-node-id="${CSS.escape(nk)}"]`);
      const h = el ? el.offsetHeight : 64;
      if (x >= p.x - 10 && x <= p.x + NODE_W + 28 && y >= p.y - 6 && y <= p.y + h + 6) return nk;
    }
    return null;
  };

  const publishLink = (m) => {
    if (!m || m.kind !== 'link') {
      setLinking(null);
      return;
    }
    setLinking({
      sourceId: m.sourceId,
      x: m.x1,
      y: m.y1,
      cx: m.cx,
      cy: m.cy,
      overId: m.overId,
      dragged: !!m.dragged,
    });
  };

  const clearMode = () => {
    modeRef.current = null;
    setDragId(null);
    setLinking(null);
  };

  useEffect(() => {
    const onMove = (e) => {
      const m = modeRef.current;
      if (!m) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pt = canvasPoint(canvas, e.clientX, e.clientY);
      if (m.kind === 'drag') {
        const x = Math.max(8, pt.x - m.ox);
        const y = Math.max(8, pt.y - m.oy);
        setPos((prev) => {
          const next = new Map(prev);
          next.set(m.id, { x, y });
          return next;
        });
        return;
      }
      if (m.kind === 'link') {
        const over = hitNodeAt(e.clientX, e.clientY);
        const overId = over && over !== m.sourceId ? over : null;
        const dist = Math.hypot(pt.x - m.sx, pt.y - m.sy);
        const dragged = m.dragged || dist >= DRAG_THRESH;
        const next = { ...m, cx: pt.x, cy: pt.y, overId, dragged };
        modeRef.current = next;
        publishLink(next);
      }
    };
    const onUp = async (e) => {
      const m = modeRef.current;
      if (!m) return;
      if (m.kind === 'drag') {
        // 位置记住（#153）：拖完写盘——重开还原，连线跟着节点走
        userMovedRef.current.add(m.id);
        savePos(scopeKeyRef.current, posRef.current);
        clearMode();
        return;
      }
      if (m.kind === 'link') {
        const dst = m.overId || hitNodeAt(e.clientX, e.clientY);
        const src = m.sourceId;
        if (dst && dst !== src) {
          clearMode();
          await commitRef.current(src, dst);
          return;
        }
        if (m.dragged) {
          clearMode();
          return;
        }
        const srcNode = byNodeKeyRef.current.get(src);
        toastRef.current(`已选 #${srcNode?.id ?? src}，再点目标画出有向边`);
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') clearMode();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', clearMode);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', clearMode);
      window.removeEventListener('keydown', onKey);
    };
    // 只挂一次：内部全部走 ref / setState，不依赖渲染期值
  }, []);

  return { publishLink, clearMode };
}
