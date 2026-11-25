// 侧栏命名空间配置的持久化（#180）：settings 表（一个 JSON 字段）是真相，
// localStorage 只作降级缓存 + 一次性迁移；prefs 里的其它显示态（order/folded）仍走本地。
import { useCallback, useEffect, useRef } from 'react';
import { getSettings, saveSettings } from './page/settings/api.js';
import { loadPrefs, savePrefs } from './prefs.js';
import type { Prefs } from './types.js';

export type PatchPrefs = (patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => void;

export function useNsPersist(
  prefs: Prefs,
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>,
  toast: (msg: string) => void
): PatchPrefs {
  const nsSaveRef = useRef<{ groups?: Prefs['namespaces']; focus?: string }>({});
  const nsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #264 修复：函数式补丁要打在**活状态**上。旧路径 updatePrefs 把补丁打在
  // localStorage（loadPrefs）上，而命名空间走「settings 表恢复」时从不回写
  // localStorage——首个 withNs 补丁（拖拽排序/增删成员/重命名…）读到空列表，
  // 会把整份分区清空。ref 同步活值，同 tick 连发补丁也能链式看到上一次结果。
  const prefsRef = useRef<Prefs>(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    let alive = true;
    // #181：**浏览器记录优先**——localStorage 里的 ns 状态在刷新 / 重开页面时
    // 先同步恢复（不等待网络），再把同样的状态写回 settings 表作为跨浏览器备份。
    const legacy = loadPrefs();
    if ((legacy.namespaces || []).length || legacy.focusNs) {
      const groups = legacy.namespaces || [];
      const focus = legacy.focusNs || '';
      setPrefs((prev) => ({ ...prev, namespaces: groups, focusNs: focus }));
      void saveSettings({ sidebarNamespaces: { groups, focus } }).catch(() => { /* 备份失败不影响本机恢复 */ });
      return () => { alive = false; };
    }
    // 浏览器无记录（新浏览器 / 清过缓存）→ 从 settings 表恢复
    getSettings().then((s) => {
      if (!alive || !s || !Array.isArray(s.sidebarNamespaces?.groups)) return;
      const cfg = s.sidebarNamespaces;
      if (!cfg.groups.length && !cfg.focus) return;
      setPrefs((prev) => ({ ...prev, namespaces: cfg.groups, focusNs: cfg.focus || '' }));
      // 恢复值同步回 localStorage：后续 withNs 函数式补丁以它为基底（#264 数据丢失修复）
      savePrefs({ ...loadPrefs(), namespaces: cfg.groups, focusNs: cfg.focus || '' });
    }).catch(() => { /* 设置读不到 → 平铺兜底，不炸面板 */ });
    return () => { alive = false; };
  }, [setPrefs]);

  return useCallback((patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => {
    const resolved = typeof patch === 'function' ? patch(prefsRef.current) : patch;
    const next: Prefs = { ...prefsRef.current, ...resolved };
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
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
  }, [setPrefs, toast]);
}
