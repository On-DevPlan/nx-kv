// 划选浮条（selMenu）状态：预览态 mouseup、编辑器 onTextSel、浮层定位与关闭。
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSelMenu({ id }) {
  const [selMenu, setSelMenu] = useState(null);
  const lastSel = useRef('');

  useEffect(() => {
    setSelMenu(null);
    lastSel.current = '';
  }, [id]);

  useEffect(() => {
    // 滚动收起浮层
    const close = () => setSelMenu(null);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, []);

  const placeSelMenu = useCallback((kind, text, x, y, extra = {}) => {
    lastSel.current = text;
    setSelMenu({
      kind,
      text,
      ...extra,
      x: Math.min(window.innerWidth - 300, Math.max(8, x)),
      y: Math.min(window.innerHeight - 240, Math.max(8, y)),
    });
  }, []);

  const onEditorTextSel = useCallback((info) => {
    if (!info?.text || info.text.length < 1) {
      setSelMenu(null);
      return;
    }
    lastSel.current = info.text;
    setSelMenu({
      kind: 'format',
      text: info.text,
      x: Math.min(window.innerWidth - 300, Math.max(8, info.x)),
      y: Math.min(window.innerHeight - 240, Math.max(8, info.y)),
    });
  }, []);

  const closeSelMenu = useCallback(() => {
    setSelMenu(null);
    lastSel.current = '';
  }, []);

  return {
    selMenu, setSelMenu, lastSel,
    placeSelMenu, onEditorTextSel, closeSelMenu,
  };
}
