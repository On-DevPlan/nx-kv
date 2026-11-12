// 底部状态栏 / 抽屉（#79，VSCode 风）——状态与交互集中在这里。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from 'react';

export const DOCK_MIN = 96;

/** useDock 的返回面（抽屉开关、页签、高度与被拖拽句柄）。 */
export interface DockState {
  dockOpen: boolean;
  setDockOpen: Dispatch<SetStateAction<boolean>>;
  dockTab: string;
  setDockTab: Dispatch<SetStateAction<string>>;
  dockH: number;
  dockHRef: RefObject<number>;
  dockRef: RefObject<HTMLDivElement | null>;
  dockMax: boolean;
  setDockMax: Dispatch<SetStateAction<boolean>>;
  dockPrevHRef: RefObject<number>;
  showDockTab: (tab: string) => void;
  onDockDragStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
  toggleDockMax: () => void;
}

/**
 * @param ns 存储命名空间（默认 'task'）。文档页用 'doc'——两个页面的面板高度 /
 *           开合 / 当前 tab 各记各的，不互相串（同一物理位置，不同宿主）。
 * @param defaultOpen 首次进入（localStorage 里还没有记录）时的开合。任务页默认开
 *            （附件是交付主路径）；文档页默认收（编辑正文为主，入口留在状态栏）。
 */
export function useDock(ns = 'task', defaultOpen = true): DockState {
  // 键名拼装收进 useCallback：它进 effect / 拖拽回调的依赖表，不能在渲染里裸建
  const k = useCallback((s: string) => `nxkv.${ns}Dock${s}`, [ns]);
  const [dockOpen, setDockOpen] = useState(() => {
    const v = localStorage.getItem(k('Open'));
    return v === null ? defaultOpen : v !== '0';
  });
  const [dockTab, setDockTab] = useState(() => localStorage.getItem(k('Tab')) || 'attach');
  const [dockH, setDockH] = useState(() => {
    const v = Number(localStorage.getItem(k('H')));
    return Number.isFinite(v) && v >= DOCK_MIN ? v : 176;
  });
  const dockHRef = useRef(dockH);
  dockHRef.current = dockH;
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockMax, setDockMax] = useState(false);
  const dockPrevHRef = useRef(176);

  useEffect(() => {
    localStorage.setItem(k('Open'), dockOpen ? '1' : '0');
  }, [dockOpen, k]);
  useEffect(() => {
    localStorage.setItem(k('Tab'), dockTab);
  }, [dockTab, k]);

  const showDockTab = useCallback((tab: string) => {
    setDockTab(tab);
    setDockOpen(true);
  }, []);

  const onDockDragStart = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!dockOpen) return;
      e.preventDefault();
      setDockMax(false);
      const startY = e.clientY;
      const startH = dockHRef.current;
      const hostH = dockRef.current?.parentElement?.clientHeight || window.innerHeight;
      const clamp = (h: number) =>
        Math.max(DOCK_MIN, Math.min(Math.round(hostH * 0.62), Math.round(h)));
      const move = (ev: MouseEvent) => {
        const h = clamp(startH - (ev.clientY - startY));
        dockHRef.current = h;
        setDockH(h);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem(k('H'), String(dockHRef.current));
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [dockOpen, k]
  );

  const toggleDockMax = useCallback(() => {
    if (dockMax) {
      setDockH(dockPrevHRef.current);
      setDockMax(false);
      return;
    }
    dockPrevHRef.current = dockHRef.current;
    const hostH = dockRef.current?.parentElement?.clientHeight || window.innerHeight;
    const h = Math.max(DOCK_MIN, Math.round(hostH * 0.62));
    dockHRef.current = h;
    setDockH(h);
    setDockMax(true);
  }, [dockMax]);

  return {
    dockOpen, setDockOpen, dockTab, setDockTab, dockH, dockHRef, dockRef,
    dockMax, setDockMax, dockPrevHRef, showDockTab, onDockDragStart, toggleDockMax,
  };
}
