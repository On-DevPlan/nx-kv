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
import type { DragEvent as ReactDragEvent } from 'react';
import type { Prefs, SidebarNs } from '../../types.js';

/** 落点：行前 / 行后 / 行内（仅看板）/ 末尾。 */
export type DropZone = 'before' | 'after' | 'into' | 'tail';

/** 被拖 / 落点行的最小形状（side model 的行都满足）。 */
export interface DragRow {
  type: string;
  key?: string;
  id?: string;
  name?: string;
}

/** 排序键：仓库用 key，看板用 id（与 model.js 的 rKey 同口径）。 */
function keyOf(r: DragRow): string {
  return r.type === 'board' ? 'board:' + String(r.id ?? '') : String(r.key ?? '');
}

export function zoneOf(e: ReactDragEvent<HTMLElement>, rowEl: HTMLElement): DropZone {
  const r = rowEl.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = r.height;
  if (y < h * 0.3) return 'before';
  if (y > h * 0.7) return 'after';
  return 'into';
}

export function canDrop(drag: DragRow | null, target: DragRow, zone: DropZone): boolean {
  if (!drag) return false;
  // #167 namespace 头行：分区排序（分区↔分区）与收编条目（条目→分区任意段）
  if (drag.type === 'ns') return target.type === 'ns' && target.id !== drag.id && zone !== 'into';
  if (target.type === 'ns') return drag.type === 'repo' || drag.type === 'board';
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
export function dropLabel(drag: DragRow, target: DragRow, zone: DropZone): string {
  if (target.type === 'ns' && drag.type !== 'ns') return `移入分区「${target.name ?? ''}」`;
  if (target.type === 'ns' && drag.type === 'ns') return `排到「${target.name ?? ''}」${zone === 'before' ? '之前' : '之后'}`;
  if (target.type === 'board' && zone === 'into') return `归入看板「${target.name ?? ''}」`;
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
/** namespace 列表的读取收口（namespaces 缺省 = 无分区，走旧逻辑）。 */
function nsListOf(prefs: Partial<Prefs>): SidebarNs[] {
  return Array.isArray(prefs.namespaces) ? prefs.namespaces : [];
}

export function applyDrop(prefs: Partial<Prefs>, drag: DragRow, target: DragRow, zone: DropZone): Partial<Prefs> {
  const nsList = nsListOf(prefs);

  // ── namespace 分区拖拽（#167）──
  // 分区头 ↔ 分区头：调整分区顺序（pinned 位次也随数组走）
  if (drag.type === 'ns' && target.type === 'ns') {
    const i = nsList.findIndex((n) => n.id === drag.id);
    const j = nsList.findIndex((n) => n.id === target.id);
    if (i < 0 || j < 0 || i === j) return {};
    const arr = nsList.map((n) => ({ ...n, items: [...n.items] }));
    const [moved] = arr.splice(i, 1);
    if (!moved) return {};
    arr.splice(zone === 'before' ? (j > i ? j - 1 : j) : j, 0, moved);
    return { namespaces: arr };
  }
  // 条目 → 分区头：加入该分区末尾（zone 任意段都收）
  if (target.type === 'ns' && (drag.type === 'repo' || drag.type === 'board')) {
    const keyD = keyOf(drag);
    // #180：命名空间是标签——同一个 topic 可以同时在多个 ns 里，不再从旧 ns 挪走
    const arr = nsList.map((n) => ({ ...n, items: [...n.items] }));
    const t = arr.find((n) => n.id === target.id);
    if (!t || t.items.includes(keyD)) return {};
    t.items.push(keyD);
    return { namespaces: arr };
  }

  // 条目 → 条目：目标在某分区内 = 移入该分区并插到该位；目标未分组 = 拖出分区回平铺区
  const keyD = keyOf(drag);
  const keyT = keyOf(target);
  const targetNs = nsList.find((n) => n.items.includes(keyT));
  if (targetNs && (drag.type === 'repo' || drag.type === 'board')) {
    // #180：拖到某 ns 的成员上 = 加入该 ns（多归属），不再从别处挪走
    const arr = nsList.map((n) => ({ ...n, items: [...n.items] }));
    const t = arr.find((n) => n.id === targetNs.id)!;
    if (t.items.includes(keyD)) return {};
    const at = t.items.indexOf(keyT);
    t.items.splice(zone === 'before' ? at : at + 1, 0, keyD);
    return { namespaces: arr };
  }
  // #180：拖到成员上 = 加入目标命名空间（上面 targetNs 分支已处理）；
  // 从某个命名空间移除走行菜单「从本空间移出」——拖拽只做加法，语义单一。

  // ── 旧逻辑（双方都不在分区里）──
  const order = [...(prefs.order || [])];

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
