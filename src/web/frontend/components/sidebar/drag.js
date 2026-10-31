// 侧边栏拖拽落点判定（纯函数）——三段式落点，吸收自 nx-ft：
//   行上缘 30% = before（排到它前面，指示线）
//   行下缘 30% = after （排到它后面，指示线）
//   中段      = into （移入该看板，仅看板行接受，描边；仓库行中段不作落点——
//                      没有「仓库套仓库」，不给假提示）
//   树空白处  = tail （拖到末尾）
//
// **拖拽只改顺序，不改归属**：归属是数据（看板成员表），由行菜单里的
// 「归入/移出看板」改；拖拽是显示态（prefs.order）。以前拖进「分组」会写
// prefs.dirGroups —— 那套本地分组已经废弃，看板才是唯一归属。

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
  if (drag.type === 'repo') {
    if (target.type === 'board') return zone === 'into'; // 仓库→看板：仅入组（拖拽仅排序，不改归属，见文件头）
    if (target.type === 'repo') return zone === 'before' || zone === 'after'; // 排序
    return false;
  }
  if (drag.type === 'board') {
    if (target.type === 'board') return target.id !== drag.id && (zone === 'before' || zone === 'after');
    return false; // 看板不进仓库行
  }
  return false;
}

// 拖拽文案（跟随提示）
export function dropLabel(drag, target, zone) {
  if (target.type === 'board' && zone === 'into') return `归入看板「${target.name}」`;
  const name = target.name || '';
  if (zone === 'before') return `排到「${name}」之前`;
  if (zone === 'after') return `排到「${name}」之后`;
  if (zone === 'tail') return '移到末尾';
  return '';
}

/**
 * 把落点应用到偏好（纯函数，返回 patch 片段）。
 * 只回 {order} —— 排序是显示态；归属不动（那是数据，走行菜单）。
 */
export function applyDrop(prefs, drag, target, zone) {
  const order = [...(prefs.order || [])];
  const keyOf = (r) => (r.type === 'board' ? 'board:' + r.id : r.key);

  if (drag.type === 'repo' && target.type === 'repo') {
    const others = order.filter((k) => k !== keyOf(drag));
    const at = others.indexOf(keyOf(target));
    if (at < 0) return { order };
    others.splice(zone === 'before' ? at : at + 1, 0, keyOf(drag));
    return { order: others };
  }

  if (drag.type === 'board' && target.type === 'board') {
    const others = order.filter((k) => k !== keyOf(drag));
    const at = others.indexOf(keyOf(target));
    if (at < 0) return { order };
    others.splice(zone === 'before' ? at : at + 1, 0, keyOf(drag));
    return { order: others };
  }

  return {};
}
