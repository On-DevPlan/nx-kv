// 侧边栏视图偏好（localStorage）——**只是显示态，不是数据**。
//
// 以前这里还存着 groups / dirGroups（侧边栏自己的「分组」），那套东西与仓库页的
// 看板（board）是两套互不相干的存储：换浏览器分组就没了，改看板侧边栏也不知道。
// 2026-10-29 起分组统一走看板，prefs 只剩 UI 层的几件事：
//   order / hidden / groupOpen / folded —— 排序、隐藏、展开态、收起态。
//
// 键位与既有 nx-kv-ui 分开：这里只存侧边栏编排/折叠态/默认收起三件事。
const KEY = 'nx-kv-sidebar-v1';

const DEFAULTS = {
  order: [],        // 顶层条目序：['board:<id>' | '<仓库key>']（未列出的按自然序追加）
  hidden: [],       // 隐藏的仓库 key（只是不显示，登记与数据不动）
  groupOpen: {},    // 看板 id -> bool（展开态）
  folded: false,    // 侧边栏当前收起态
  defaultFolded: false,  // 进入面板时默认收起侧边栏
  defaultGroupFolded: false, // 看板初始展开态
};

// 旧结构里的 groups / dirGroups —— 它们是**独立的假数据**，不迁移、直接丢弃。
// 迁移它们等于把浏览器本地的一次性编排升格成正式数据，与看板重复且永远对不上。
function stripLegacy(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  // eslint-disable-next-line no-unused-vars -- 解构出来就是为了丢弃这两个旧字段
  const { groups, dirGroups, ...rest } = raw;
  return rest;
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = stripLegacy(JSON.parse(raw));
    const next = { ...DEFAULTS, ...parsed };
    // 读的时候顺手把旧字段从盘上抹掉（下次保存就是干净结构）
    if (parsed && typeof parsed === 'object' && ('groups' in parsed || 'dirGroups' in parsed)) {
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 隐私模式等静默降级 */ }
    }
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 隐私模式等场景静默降级 */
  }
}

export function updatePrefs(patch) {
  const next = { ...loadPrefs(), ...(typeof patch === 'function' ? patch(loadPrefs()) : patch) };
  savePrefs(next);
  return next;
}

// 给定条目的自然序（数据序），加上用户编排序 → 最终展示序。
// 编排只存「调整过位置的条目」，新条目自动追加在末尾，不需要迁移。
export function applyOrder(order, items, idOf) {
  const byId = new Map(items.map((it) => [idOf(it), it]));
  const out = [];
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
