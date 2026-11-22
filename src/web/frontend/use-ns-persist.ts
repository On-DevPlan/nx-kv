// 侧栏命名空间配置的持久化（#180）：settings 表（一个 JSON 字段）是真相，
// localStorage 只作降级缓存 + 一次性迁移；prefs 里的其它显示态（order/folded）仍走本地。
import { useCallback, useEffect, useRef } from 'react';
import { getSettings, saveSettings } from './page/settings/api.js';
import { loadPrefs, updatePrefs } from './prefs.js';
import type { Prefs } from './types.js';

export type PatchPrefs = (patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => void;

export function useNsPersist(
  prefs: Prefs,
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>,
  toast: (msg: string) => void
): PatchPrefs {
  const nsSaveRef = useRef<{ groups?: Prefs['namespaces']; focus?: string }>({});
  const nsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => {
      if (!alive || !s || !Array.isArray(s.sidebarNamespaces?.groups)) return;
      const cfg = s.sidebarNamespaces;
      const legacy = loadPrefs();
      if (!cfg.groups.length && !cfg.focus && (legacy.namespaces || []).length) {
        // 老数据迁移：localStorage → settings 表（一次性）
        void saveSettings({ sidebarNamespaces: { groups: legacy.namespaces, focus: legacy.focusNs || '' } });
        return;
      }
      setPrefs((prev) => ({ ...prev, namespaces: cfg.groups, focusNs: cfg.focus || '' }));
    }).catch(() => { /* 设置读不到 → 沿用 localStorage 缓存，不炸面板 */ });
    return () => { alive = false; };
  }, [setPrefs]);

  return useCallback((patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => {
    const resolved = typeof patch === 'function' ? patch(prefs) : patch;
    setPrefs(updatePrefs(patch));
    if (resolved.namespaces === undefined && resolved.focusNs === undefined) return;
    if (resolved.namespaces !== undefined) nsSaveRef.current.groups = resolved.namespaces;
    if (resolved.focusNs !== undefined) nsSaveRef.current.focus = String(resolved.focusNs || '');
    if (nsTimerRef.current) clearTimeout(nsTimerRef.current);
    nsTimerRef.current = setTimeout(async () => {
      const p = nsSaveRef.current;
      nsSaveRef.current = {};
      try {
        const s = await getSettings();
        await saveSettings({
          sidebarNamespaces: {
            groups: p.groups ?? s?.sidebarNamespaces?.groups ?? [],
            focus: p.focus ?? s?.sidebarNamespaces?.focus ?? '',
          },
        });
      } catch {
        toast('命名空间配置保存失败（已暂存在本机）');
      }
    }, 350);
  }, [prefs, setPrefs, toast]);
}
