// 侧栏宽度分隔条（对齐 nx-ft shell-resizer）：像素宽 + localStorage + 键盘可达。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';
import './side-resizer.css';

const SIDE_W_KEY = 'nx-kv-side-w';
export const SIDE_W_DEFAULT = 232;
export const SIDE_W_MIN = 160;
export const SIDE_W_MAX = 480;

const clamp = (v: number) => Math.min(SIDE_W_MAX, Math.max(SIDE_W_MIN, v));

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(SIDE_W_KEY);
    if (raw == null) return SIDE_W_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : SIDE_W_DEFAULT;
  } catch {
    return SIDE_W_DEFAULT;
  }
}

/** useSideWidth 入参。 */
export interface SideWidthOptions {
  disabled?: boolean;
}

/** useSideWidth 的返回面（宽度 + 拖拽/键盘句柄）。 */
export interface SideWidthApi {
  sideW: number;
  setSideW: Dispatch<SetStateAction<number>>;
  beginDrag: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  reset: () => void;
}

export function useSideWidth({ disabled = false }: SideWidthOptions = {}): SideWidthApi {
  const [sideW, setSideW] = useState(loadWidth);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--side-w', `${sideW}px`);
    try {
      localStorage.setItem(SIDE_W_KEY, String(Math.round(sideW)));
    } catch { /* 隐私模式 */ }
  }, [sideW]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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

  const beginDrag = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    drag.current = { startX: e.clientX, startW: sideW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('sp-dragging');
    e.preventDefault();
  }, [disabled, sideW]);

  const reset = useCallback(() => setSideW(SIDE_W_DEFAULT), []);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 24 : 8;
    let next: number | null = null;
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

/** SideResizer 入参（句柄都来自 useSideWidth）。 */
export interface SideResizerProps {
  sideW: number;
  beginDrag: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  reset: () => void;
  hidden?: boolean;
}

export function SideResizer({ sideW, beginDrag, onKeyDown, reset, hidden }: SideResizerProps) {
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
