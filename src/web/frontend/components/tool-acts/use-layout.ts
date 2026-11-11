// 工具区编排持久化（#139/#143）：localStorage key = nx-kv-tb-{dir|group|task|doc}
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { defaultLayout, normalizeLayout } from './modules.js';
import type { LayoutItem } from './modules.js';

const STORAGE_KEY = (kind: string) => `nx-kv-tb-${kind}`;

/** useToolActsLayout 的返回面（layout + 写入 + 恢复默认）。 */
export interface ToolActsLayoutApi {
  layout: LayoutItem[];
  setLayout: Dispatch<SetStateAction<LayoutItem[]>>;
  resetLayout: () => void;
}

export function useToolActsLayout(kind: string): ToolActsLayoutApi {
  const [layout, setLayout] = useState<LayoutItem[]>(() => {
    try {
      // 外部数据边界：localStorage 里是任意 JSON，形状由 normalizeLayout 校验
      const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY(kind)) ?? 'null');
      if (Array.isArray(raw)) return normalizeLayout(kind, raw as LayoutItem[]);
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
