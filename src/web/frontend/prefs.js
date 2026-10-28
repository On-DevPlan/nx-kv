// 侧边栏视图偏好（localStorage）——视图偏好不是数据，绝不写进 localtasks.json。
// 键位与既有 nx-kv-ui 分开：这里只存侧边栏编排/折叠态/默认收起三件事。
const KEY = 'nx-kv-sidebar-v1';

const DEFAULTS = {
  order: [],        // 顶层条目序：[{type:'group',id}|{type:'dir',key}...]（未列出的按自然序追加）
  groups: [],       // 分组：[{id,name}]
  dirGroups: {},    // key -> 分组 id（目录归属；'' = 未分组）
  groupOpen: {},    // 分组 id -> bool（展开态）
  folded: false,    // 侧边栏当前收起态
  defaultFolded: false,  // 进入面板时默认收起侧边栏
  defaultGroupFolded: false, // 分组初始展开态
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
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

// 给定目录 key 的自然序（数据序），加上用户编排序 → 最终展示序。
// 编排只存「调整过位置的条目」，新目录自动追加在末尾，不需要迁移。
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
