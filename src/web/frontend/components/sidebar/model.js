// 侧边栏数据模型（纯函数，不碰 DOM/网络）：
//   - rows: 数据行（来自 /api/localtasks 的 topics + 偏好里的分组）
//   - out: 渲染序的扁平行列表（分组行 + 目录行交错），搜索过滤后同样适用
//
// 「可见序 = 渲染序」是键盘导航的前提：↑↓ 走的就是这份扁平序。

import { applyOrder } from '../../prefs.js';

export const GLOBAL_KEY = '__GLOBAL__';

/**
 * 构建侧边栏行模型。
 * @param topics 本机主题行（board.js mergeDirectoryRows 的产物，含 isGlobal）
 * @param prefs  侧边栏偏好（groups / dirGroups / order / groupOpen）
 * @param kw     搜索关键词（'' = 不过滤）
 * @returns {{rows: Array, matchCount: number}}
 */
export function buildTree(topics, prefs, kw = '') {
  const q = String(kw || '').trim().toLowerCase();
  const hidden = new Set(prefs.hidden || []);
  const dirs = topics.filter((t) => !t.isGlobal && !hidden.has(t.key));
  const globalRow = topics.find((t) => t.isGlobal) || null;

  // 目录按偏好编排；分组按 prefs.groups + 未分组目录
  const groupList = (prefs.groups || []).map((g) => ({ ...g }));
  const dirGroupOf = (key) => (prefs.dirGroups || {})[key] || '';
  const orderedDirs = applyOrder(prefs.order || [], dirs, (d) => d.key);

  // 搜索：命中目录（名称/路径/现状摘要）或其后代（目录即叶子，后代=自身）
  const hit = (d) =>
    !q ||
    String(d.name || '').toLowerCase().includes(q) ||
    String(d.cwd || '').toLowerCase().includes(q) ||
    String(d.summary || d.topic?.summary || '').toLowerCase().includes(q);

  const matched = orderedDirs.filter(hit);

  const rows = [];
  // 全局池恒顶
  if (globalRow) {
    rows.push({
      type: 'global',
      key: GLOBAL_KEY,
      name: globalRow.name || '全局任务',
      topic: globalRow,
      pending: globalRow.pending || 0,
      waiting: !!globalRow.waiting,
    });
  }

  const grouped = new Set();
  for (const g of groupList) {
    const members = matched.filter((d) => dirGroupOf(d.key) === g.id);
    const allInGroup = orderedDirs.filter((d) => dirGroupOf(d.key) === g.id);
    if (!q && !allInGroup.length && !g.touched) continue; // 空分组且用户没动过就不渲染（避免垃圾行）
    const open = q ? true : (prefs.groupOpen || {})[g.id] ?? !prefs.defaultGroupFolded;
    rows.push({ type: 'group', id: g.id, name: g.name, open, count: allInGroup.length });
    if (open) {
      for (const d of members) {
        grouped.add(d.key);
        rows.push({ type: 'dir', ...dirRowOf(d), groupId: g.id });
      }
    }
  }
  // 未分组目录
  for (const d of matched) {
    if (grouped.has(d.key) || dirGroupOf(d.key)) continue;
    rows.push({ type: 'dir', ...dirRowOf(d), groupId: '' });
  }

  return { rows, matchCount: q ? matched.length : 0 };
}

function dirRowOf(d) {
  return {
    key: d.key,
    name: d.name,
    cwd: d.cwd || '',
    summary: d.summary || '',
    pending: d.pending || 0,
    waiting: !!d.waiting,
    manual: !!d.manual,
    topic: d,
  };
}

/** 深链 #/dir/<key> 进入时沿途分组自动展开（chainByKey 思路）。 */
export function chainOpen(prefs, key) {
  const gid = (prefs.dirGroups || {})[key];
  if (!gid) return prefs;
  return { ...prefs, groupOpen: { ...(prefs.groupOpen || {}), [gid]: true } };
}
