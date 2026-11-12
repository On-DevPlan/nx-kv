// 全局面板状态：bootstrap 数据 + 会话级选择。
// 关键约定：凡是「刷新后不该丢」的用户选择（当前视图、中心/项目路径、多选勾选）
// 一律走 persist 读写 localStorage——UI 状态持久化是模板的硬标准，不是可选项。
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api/client.js';
import type { BootData, BundledData } from './types.js';

const LS_KEY = 'nx-kv-ui';

/** 会话级选择（存 localStorage 的那份）。视图私有字段（多选勾选等）按 key 挂着。 */
export interface UiState {
  [k: string]: any;
}

// 只持久化「选择」，不持久化「数据」——数据永远从 /api 拉，避免陈旧缓存。
const DEFAULT_UI: UiState = {};

function loadUi(): UiState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_UI };
    // localStorage 是外部数据（旧版本写的结构可能缺字段）：合并默认值兜底
    return { ...DEFAULT_UI, ...(JSON.parse(raw) as Partial<UiState>) };
  } catch {
    return { ...DEFAULT_UI };
  }
}

/** StoreProvider 提供给全树的读写面。 */
export interface StoreValue {
  boot: BootData | null;
  bundled: BundledData | null;
  ui: UiState;
  patchUi: (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) => void;
  /** 多选勾选的通用开关（勾选集合以 key 挂在 ui 上）。 */
  toggleSel: (key: string, name: string) => void;
  refreshBoot: () => Promise<BootData>;
  refreshBundled: () => Promise<void>;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children?: ReactNode }) {
  const [boot, setBoot] = useState<BootData | null>(null);      // /api/bootstrap 结果
  const [bundled, setBundled] = useState<BundledData | null>(null);
  const [ui, setUi] = useState<UiState>(loadUi);

  // UI 选择变化即落盘（同步、廉价、无版本迁移问题——字段级合并已兜底）
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(ui)); } catch { /* 隐私模式等场景静默降级 */ }
  }, [ui]);

  const refreshBoot = useCallback(async () => {
    const b = await api<BootData>('/api/bootstrap');
    setBoot(b);
    return b;
  }, []);

  const refreshBundled = useCallback(async () => {
    setBundled(await api<BundledData>('/api/bundled').catch(() => null));
  }, []);

  useEffect(() => { refreshBoot(); refreshBundled(); }, [refreshBoot, refreshBundled]);

  // 支持对象 patch 与函数式 patch（函数式用于「基于最新 state 修剪」场景，避免闭包旧值覆盖）
  const patchUi = useCallback((patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) => {
    setUi((u) => (typeof patch === 'function' ? { ...u, ...patch(u) } : { ...u, ...patch }));
  }, []);
  const toggleSel = useCallback((key: string, name: string) => {
    setUi((u) => {
      const set = new Set<string>(u[key] as string[]);
      if (set.has(name)) set.delete(name); else set.add(name);
      return { ...u, [key]: [...set] };
    });
  }, []);

  const value = useMemo(
    () => ({ boot, bundled, ui, patchUi, toggleSel, refreshBoot, refreshBundled }),
    [boot, bundled, ui, patchUi, toggleSel, refreshBoot, refreshBundled]
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
