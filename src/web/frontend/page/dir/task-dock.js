// 底部状态栏 / 抽屉（#79，VSCode 风）——状态与交互集中在这里。
import { useCallback, useEffect, useRef, useState } from 'react';

export const DOCK_MIN = 96;

export function useDock() {
  const [dockOpen, setDockOpen] = useState(() => localStorage.getItem('nxkv.taskDockOpen') !== '0');
  const [dockTab, setDockTab] = useState(() => localStorage.getItem('nxkv.taskDockTab') || 'attach');
  const [dockH, setDockH] = useState(() => {
    const v = Number(localStorage.getItem('nxkv.taskDockH'));
    return Number.isFinite(v) && v >= DOCK_MIN ? v : 176;
  });
  const dockHRef = useRef(dockH);
  dockHRef.current = dockH;
  const dockRef = useRef(null);
  const [dockMax, setDockMax] = useState(false);
  const dockPrevHRef = useRef(176);

  useEffect(() => {
    localStorage.setItem('nxkv.taskDockOpen', dockOpen ? '1' : '0');
  }, [dockOpen]);
  useEffect(() => {
    localStorage.setItem('nxkv.taskDockTab', dockTab);
  }, [dockTab]);

  const showDockTab = useCallback((tab) => {
    setDockTab(tab);
    setDockOpen(true);
  }, []);

  const onDockDragStart = useCallback(
    (e) => {
      if (!dockOpen) return;
      e.preventDefault();
      setDockMax(false);
      const startY = e.clientY;
      const startH = dockHRef.current;
      const hostH = dockRef.current?.parentElement?.clientHeight || window.innerHeight;
      const clamp = (h) =>
        Math.max(DOCK_MIN, Math.min(Math.round(hostH * 0.62), Math.round(h)));
      const move = (ev) => {
        const h = clamp(startH - (ev.clientY - startY));
        dockHRef.current = h;
        setDockH(h);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem('nxkv.taskDockH', String(dockHRef.current));
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [dockOpen]
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
