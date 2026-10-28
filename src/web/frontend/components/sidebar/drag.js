// 侧边栏拖拽落点判定（纯函数）——三段式落点，吸收自 nx-ft：
//   行上缘 30% = before（排到它前面，指示线）
//   行下缘 30% = after （排到它后面，指示线）
//   中段      = into （移入该分组，仅分组行接受，描边；目录行中段不作落点——
//                      没有「目录套目录」，不给假提示）
//   树空白处  = tail （拖到末尾）
// canDropInto 守卫：不能把分组放进自己的子树（这里没有子树，守卫退化为
// 「不能放进自己」+ 目标类型检查）。

export function zoneOf(e, rowEl) {
  const r = rowEl.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = r.height;
  if (y < h * 0.3) return 'before';
  if (y > h * 0.7) return 'after';
  return 'into';
}

export function canDrop(drag, target, zone) {
  if (!drag) return false;
  if (drag.type === 'dir') {
    if (target.type === 'group') return zone === 'into'; // 目录→分组：仅入组
    if (target.type === 'dir') return zone === 'before' || zone === 'after'; // 排序
    return false;
  }
  if (drag.type === 'group') {
    if (target.type === 'group') return target.id !== drag.id && (zone === 'before' || zone === 'after');
    return false; // 分组不进目录、不进树尾之外的位置
  }
  return false;
}

// 拖拽文案（跟随提示）
export function dropLabel(drag, target, zone) {
  if (target.type === 'group' && zone === 'into') return `移入分组「${target.name}」`;
  const name = target.name || '';
  if (zone === 'before') return `排到「${name}」之前`;
  if (zone === 'after') return `排到「${name}」之后`;
  if (zone === 'tail') return '移到末尾';
  return '';
}

/**
 * 把落点应用到偏好（纯函数，返回 patch 片段）。
 * @returns {{order?, groups?, dirGroups?}} 需要合并进 prefs 的字段
 */
export function applyDrop(prefs, drag, target, zone) {
  const dirGroupOf = (key) => (prefs.dirGroups || {})[key] || '';

  if (drag.type === 'dir') {
    const dirGroups = { ...(prefs.dirGroups || {}) };
    if (target.type === 'group' && zone === 'into') {
      dirGroups[drag.key] = target.id;
      return { dirGroups };
    }
    // 排序：重建顶层 order（组内序由 order 里的相对位置决定，分组归属不变）
    if (target.type === 'dir') {
      dirGroups[drag.key] = target.groupId ?? dirGroupOf(target.key);
      const others = collectDirKeys(prefs).filter((k) => k !== drag.key);
      const at = others.indexOf(target.key);
      const order = others.slice();
      order.splice(zone === 'before' ? Math.max(0, at) : at + 1, 0, drag.key);
      return { order, dirGroups };
    }
  }

  if (drag.type === 'group' && target.type === 'group') {
    const ids = (prefs.groups || []).map((g) => g.id).filter((id) => id !== drag.id);
    const at = ids.indexOf(target.key || target.id);
    ids.splice(zone === 'before' ? Math.max(0, at) : at + 1, 0, drag.id);
    const byId = new Map((prefs.groups || []).map((g) => [g.id, g]));
    return { groups: ids.map((id) => byId.get(id)).filter(Boolean) };
  }
  return {};
}

// 顶层编排序里的全部目录 key（按当前分组展开序）
function collectDirKeys(prefs) {
  // order 只存目录 key（applyOrder 用）；分组归属不影响相对顺序的重建
  return [...(prefs.order || [])];
}
