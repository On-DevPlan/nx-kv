// 工具区编排持久化（#139/#143）：localStorage key = nx-kv-tb-{dir|group|task|doc}
import { useEffect, useState } from 'react';
import { defaultLayout, normalizeLayout } from './modules.js';

const STORAGE_KEY = (kind) => `nx-kv-tb-${kind}`;

export function useToolActsLayout(kind) {
  const [layout, setLayout] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY(kind)));
      if (Array.isArray(raw)) return normalizeLayout(kind, raw);
    } catch { /* 隐私模式 / 脏数据 */ }
    return defaultLayout(kind);
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY(kind), JSON.stringify(layout));
    } catch { /* 隐私模式静默 */ }
  }, [layout, kind]);

  return {
    layout,
    setLayout,
    resetLayout: () => setLayout(defaultLayout(kind)),
  };
}
