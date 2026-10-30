// 侧边栏拖拽落点判定（纯函数）——三段式落点，吸收自 nx-ft：
//   行上缘 30% = before（排到它前面，指示线）
//   行下缘 30% = after （排到它后面，指示线）
//   中段      = into （**放进收纳盒**，仅收纳盒行接受，描边）
//   树空白处  = tail （拖到末尾；从盒子里拖出去也落这里）
//
// **拖拽改的是显示编排，不是数据归属**——这条边界是刻意的：
//   · 拖进收纳盒 = 写 prefs.groups（纯显示层，浏览器本地）
//   · 「这条仓库属于哪个项目组」是**数据**（store 里看板的成员表），只能在行菜单里改。
//     混在一起改的结果是：拖一下不知道改的是我的视图还是所有人的数据。
import { moveToGroup } from '../../prefs.js';

export function zoneOf(e, rowEl) {
  const r = rowEl.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = r.height;
  if (y < h * 0.3) return 'before';
  if (y > h * 0.7) return 'after';
  return 'into';
}

/** 一行的稳定标识：资产用 itemId，收纳盒用 'group:<id>'（与 model.js 的 rKey 同源） */
export function rKeyOf(row) {
  if (!row) return '';
  if (row.type === 'group') return 'group:' + row.id;
  if (row.type === 'board') return 'board:' + row.id;
  return 'repo:' + (row.key || row.id);
}

export function canDrop(drag, target, zone) {
  if (!drag || !target) return false;
  if (zone === 'into') {
    // 「放进盒子」只接受资产（项目 / 项目组）→ 收纳盒。盒子不能套盒子。
    if (target.type !== 'group') return false;
    return drag.type === 'repo' || drag.type === 'board';
  }
  if (target.type === 'group') {
    // 盒子之间只能排序；盒子和资产之间也能排序（= 把资产摆在盒子前后，即移到顶层）
    return drag.type === 'group' ? target.id !== drag.id : true;
  }
  // 资产之间：排序（含把盒子里的资产拖到顶层某个位置）
  return true;
}

// 拖拽文案（跟随提示）
export function dropLabel(drag, target, zone) {
  if (!target) return '';
  const name = target.name || '';
  if (zone === 'into' && target.type === 'group') return `放进收纳组「${name}」`;
  if (zone === 'before') return `排到「${name}」之前`;
  if (zone === 'after') return `排到「${name}」之后`;
  return '';
}

/**
 * 把落点应用到偏好（纯函数，返回 patch 片段）。
 *
 * @param renderIds 当前渲染序的标识数组（含嵌套行，行上下同序）。
 *   **为什么要它**：order 是稀疏的（只存用户动过的条目），拖到一个从没排过序的
 *   目标上时 `order.indexOf(target)` 是 -1，旧实现直接放弃 —— 表现为「拖了没反应」。
 *   拿渲染序做基准，落点永远能算出来；resulting order 就是完整序列，
 *   下次渲染逐条命中，顺序完全确定。
 */
export function applyDrop(prefs, drag, target, zone, renderIds) {
  const dragId = rKeyOf(drag);
  if (!dragId) return {};
  const isTail = target && target.type === 'tail';
  const targetId = isTail ? '' : rKeyOf(target);
  if (!isTail && !targetId) return {};

  // ── 1) 结构：进盒子 / 出盒子 ──
  let groups = prefs.groups || [];
  let groupOpen = null;
  if (zone === 'into' && target.type === 'group') {
    groups = moveToGroup(groups, dragId, target.id);
    // 放进去就把盒子展开——否则拖完东西像是消失了
    groupOpen = { ...(prefs.groupOpen || {}), [target.id]: true };
  } else if (drag.groupId && target.type !== 'group') {
    // 从盒子里拖到盒子外的某一行 = 取出到顶层（同时排到那个位置）
    groups = moveToGroup(groups, dragId, '');
  } else if (drag.groupId && target.type === 'group' && drag.groupId === target.id) {
    // 在自己所在的盒子行上 before/after：视为留在盒子里（只调位次）
    groups = moveToGroup(groups, dragId, target.id);
  }

  // ── 2) 顺序 ──
  const base = Array.isArray(renderIds) && renderIds.length
    ? renderIds.slice()
    : [...(prefs.order || [])];
  const patch = groupOpen ? { groups, groupOpen } : { groups };
  if (!base.length) return { ...patch, order: prefs.order || [] };

  const at = base.indexOf(dragId);
  if (at >= 0) base.splice(at, 1);

  let insertAt;
  if (isTail) {
    insertAt = base.length;
  } else if (zone === 'into') {
    const boxAt = base.indexOf(targetId);
    insertAt = boxAt < 0 ? base.length : boxAt + 1;
  } else {
    const ti = base.indexOf(targetId);
    insertAt = ti < 0 ? base.length : (zone === 'before' ? ti : ti + 1);
  }
  base.splice(insertAt, 0, dragId);

  return { ...patch, order: base };
}
