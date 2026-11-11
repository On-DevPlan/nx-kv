// 侧边栏视图偏好（localStorage）——**只是显示态，不是数据**。
//
// 以前这里还存着 groups / dirGroups（侧边栏自己的「分组」），那套东西与仓库页的
// 看板（board）是两套互不相干的存储：换浏览器分组就没了，改看板侧边栏也不知道。
// 2026-10-29 起分组统一走看板，prefs 只剩 UI 层的几件事：
//   order / hidden / folded —— 排序、隐藏、收起态。
//   （groupOpen / defaultGroupFolded 已随「组不再在树里展开」一起退役：组是叶子，
//   成员在组详情面板里下拉选择，树里没有可折叠的组。）
//
// 键位与既有 nx-kv-ui 分开：这里只存侧边栏编排/收起态几件事。
import type { Prefs } from './types.js';

const KEY = 'nx-kv-sidebar-v1';

const DEFAULTS: Prefs = {
  order: [],        // 顶层条目序：['board:<id>' | '<仓库key>']（未列出的按自然序追加）
  hidden: [],       // 隐藏的仓库 key（只是不显示，登记与数据不动）
  folded: false,    // 侧边栏当前收起态
  defaultFolded: false,  // 进入面板时默认收起侧边栏
};

// 旧结构里的 groups / dirGroups —— 它们是**独立的假数据**，不迁移、直接丢弃。
// 迁移它们等于把浏览器本地的一次性编排升格成正式数据，与看板重复且永远对不上。
function stripLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 解构出来就是为了丢弃这两个旧字段
  const { groups, dirGroups, ...rest } = raw as Record<string, unknown>;
  return rest;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // localStorage 里是外部数据（可能是旧版本写的）：按 Prefs 合并，缺字段由默认值兜
    const parsed = stripLegacy(JSON.parse(raw)) as Partial<Prefs> | null;
    const next: Prefs = { ...DEFAULTS, ...(parsed || {}) };
    // 读的时候顺手把旧字段从盘上抹掉（下次保存就是干净结构）
    if (parsed && typeof parsed === 'object' && ('groups' in parsed || 'dirGroups' in parsed)) {
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 隐私模式等静默降级 */ }
    }
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 隐私模式等场景静默降级 */
  }
}

/** patch 可以是对象，也可以是基于最新值的函数（函数式用于「先读旧值再改」）。 */
export function updatePrefs(patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)): Prefs {
  const next: Prefs = { ...loadPrefs(), ...(typeof patch === 'function' ? patch(loadPrefs()) : patch) };
  savePrefs(next);
  return next;
}

// 给定条目的自然序（数据序），加上用户编排序 → 最终展示序。
// 编排只存「调整过位置的条目」，新条目自动追加在末尾，不需要迁移。
export function applyOrder<T>(order: string[], items: T[], idOf: (item: T) => string): T[] {
  const byId = new Map<string, T>(items.map((it) => [idOf(it), it]));
  const out: T[] = [];
  for (const id of order) {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id);
    }
  }
  out.push(...byId.values());
  return out;
}
