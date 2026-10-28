// 侧栏宽度分隔条（对齐 nx-ft shell-resizer）：像素宽 + localStorage + 键盘可达。
import { useCallback, useEffect, useRef, useState } from 'react';
import './side-resizer.css';

const SIDE_W_KEY = 'nx-kv-side-w';
export const SIDE_W_DEFAULT = 232;
export const SIDE_W_MIN = 160;
export const SIDE_W_MAX = 480;

const clamp = (v) => Math.min(SIDE_W_MAX, Math.max(SIDE_W_MIN, v));

function loadWidth() {
  try {
    const raw = localStorage.getItem(SIDE_W_KEY);
    if (raw == null) return SIDE_W_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : SIDE_W_DEFAULT;
  } catch {
    return SIDE_W_DEFAULT;
  }
}

export function useSideWidth({ disabled = false } = {}) {
  const [sideW, setSideW] = useState(loadWidth);
  const drag = useRef(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--side-w', `${sideW}px`);
    try {
      localStorage.setItem(SIDE_W_KEY, String(Math.round(sideW)));
    } catch { /* 隐私模式 */ }
  }, [sideW]);

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return;
      setSideW(clamp(drag.current.startW + (e.clientX - drag.current.startX)));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('sp-dragging');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      onUp();
    };
  }, []);

  const beginDrag = useCallback((e) => {
    if (disabled) return;
    drag.current = { startX: e.clientX, startW: sideW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('sp-dragging');
    e.preventDefault();
  }, [disabled, sideW]);

  const reset = useCallback(() => setSideW(SIDE_W_DEFAULT), []);

  const onKeyDown = useCallback((e) => {
    const step = e.shiftKey ? 24 : 8;
    let next = null;
    if (e.key === 'ArrowLeft') next = sideW - step;
    else if (e.key === 'ArrowRight') next = sideW + step;
    else if (e.key === 'Home') next = SIDE_W_MIN;
    else if (e.key === 'End') next = SIDE_W_MAX;
    else if (e.key === 'Enter') next = SIDE_W_DEFAULT;
    if (next == null) return;
    e.preventDefault();
    setSideW(clamp(next));
  }, [sideW]);

  return { sideW, setSideW, beginDrag, onKeyDown, reset };
}

export function SideResizer({ sideW, beginDrag, onKeyDown, reset, hidden }) {
  if (hidden) return null;
  return (
    <div
      className="shell-resizer"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度（拖动，或用方向键）"
      aria-valuenow={Math.round(sideW)}
      aria-valuemin={SIDE_W_MIN}
      aria-valuemax={SIDE_W_MAX}
      title="拖拽调整侧边栏宽度 · 方向键微调 · 双击重置"
      onMouseDown={beginDrag}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
