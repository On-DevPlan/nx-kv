// 侧边栏视图偏好（localStorage）——**只是显示态，不是数据**。
//
// 这里装的是「怎么摆」，不是「是什么」：
//   order        资产的全局序列（'board:<id>' / 'repo:<key>' / 'group:<id>'）
//   hidden       不显示的资产（登记与数据都不动）
//   groups       收纳盒（左侧的「组」）——纯显示层的格子，可以把「项目」和「项目组」
//                摆在一起；它**不是**项目组（board），两者互不相干：
//                  · 项目组 = 数据资产，成员表在 store 里，可导出、可跨机
//                  · 收纳盒 = 浏览器本地的一次性编排，换浏览器就没了，不参与导出
//   groupOpen    收纳盒的展开态
//   folded / defaultFolded / defaultGroupFolded  收起态
//
// 历史：2026-10-29 曾把「分组」整块废弃（当时它与看板是两套重复数据）；
// 2026-10-30 用户确认「项目组和项目都是资产，左侧的组是 UI 概念」，
// 于是收纳盒以**纯显示层**的身份回到 prefs —— 这次它不与任何数据重复。
const KEY = 'nx-kv-sidebar-v1';

const DEFAULTS = {
  order: [],        // 顶层条目序：['group:<id>' | 'board:<id>' | 'repo:<key>']
  hidden: [],       // 隐藏的资产（itemId；兼容老数据的裸仓库 key）
  groups: [],       // 收纳盒：[{ id, name, members: ['board:<id>'|'repo:<key>'] }]
  groupOpen: {},    // 收纳盒 id -> bool（展开态）；缺省看 defaultGroupFolded
  folded: false,    // 侧边栏当前收起态
  defaultFolded: false,  // 进入面板时默认收起侧边栏
  defaultGroupFolded: false, // 收纳盒初始展开态（缺省展开）
};

// 旧结构里的 groups / dirGroups 是**独立的假数据**（当时与看板重复），不迁移。
// 注意：新结构也叫 groups，但成员是 itemId（'repo:…' / 'board:…'）且语义是显示层——
// 用「有没有 id」区分：老数据的分组条目没有 id 字段。
function normalizeGroups(list) {
  const out = [];
  for (const g of Array.isArray(list) ? list : []) {
    if (!g || typeof g !== 'object') continue;
    const id = typeof g.id === 'string' && g.id ? g.id : '';
    if (!id) continue; // 老版本的分组（无 id）丢弃
    out.push({
      id,
      name: String(g.name || '收纳组'),
      members: (Array.isArray(g.members) ? g.members : []).filter((m) => typeof m === 'string' && m),
    });
  }
  return out;
}

function stripLegacy(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  // eslint-disable-next-line no-unused-vars -- 解构出来就是为了丢弃这个旧字段
  const { dirGroups, ...rest } = raw;
  return rest;
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = stripLegacy(JSON.parse(raw));
    const next = { ...DEFAULTS, ...parsed };
    next.groups = normalizeGroups(parsed.groups);
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

// ─── 收纳盒（纯显示层）的纯函数操作 ────────────────────────────────────
// 全部返回**新的 groups 数组**（不改入参）：调用方直接 patchPrefs({ groups })。
// 不在这层做 id 生成以外的判断——「这条资产是什么」由模型层（model.js）决定。

/** 新建一个空收纳盒，返回 { groups, id } */
export function addGroup(groups, name) {
  const id = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nm = String(name || '').trim() || '收纳组';
  return { groups: [...(groups || []), { id, name: nm, members: [] }], id };
}

/** 重命名（空名忽略） */
export function renameGroup(groups, id, name) {
  const nm = String(name || '').trim();
  if (!nm) return groups || [];
  return (groups || []).map((g) => (g.id === id ? { ...g, name: nm } : g));
}

/** 删盒子 = 只拆格子：里面的资产回到顶层平铺，资产本身不动 */
export function removeGroup(groups, id) {
  return (groups || []).filter((g) => g.id !== id);
}

/**
 * 把资产放进盒子（groupId 空 = 取出到顶层）。
 * 一条资产最多在一个盒子里——放进去之前先从别的盒子摘掉（不存在多盒副本）。
 */
export function moveToGroup(groups, itemId, groupId) {
  const id = String(itemId || '');
  const list = (groups || []).map((g) => ({
    ...g,
    members: (g.members || []).filter((m) => m !== id),
  }));
  if (!groupId) return list;
  return list.map((g) => (g.id === groupId ? { ...g, members: [...g.members, id] } : g));
}

/** 这条资产现在在哪个盒子里（'' = 顶层） */
export function groupOf(groups, itemId) {
  for (const g of groups || []) if ((g.members || []).includes(itemId)) return g.id;
  return '';
}
