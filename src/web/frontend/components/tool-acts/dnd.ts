// 工具区编排排序内核（#141，对齐 nx-ft toolbar-dnd）：纯函数、不碰 DOM。
// layout 数组次序 = 工具栏渲染次序；落点统一 { anchorId, after }。
import { metaOf, onBarOf } from './modules.js';
import type { LayoutItem } from './modules.js';

/** moveModule 的落点：挪谁（id）+ 锚点（anchorId/after）+ 可选显隐。 */
export interface MoveTarget {
  id: string;
  anchorId?: string | null;
  after?: boolean;
  visible?: boolean;
}

export function isLocked(kind: string, id: string): boolean {
  // 主按钮 / 「更多」入口：不可拖离工具栏语义由 noHide 管；主按钮还可锁末位
  return !!metaOf(kind, id).lockLast;
}

export function setFlag(layout: LayoutItem[], id: string, patch: Partial<LayoutItem>): LayoutItem[] {
  return layout.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/**
 * 挪一项到锚点前/后；可同时改 visible（从「更多」拖上工具栏 / 拖回更多）。
 * @param {Array} layout
 * @param {{ id:string, anchorId?:string|null, after?:boolean, visible?:boolean }} opts
 */
export function moveModule(kind: string, layout: LayoutItem[], { id, anchorId = null, after = false, visible }: MoveTarget): LayoutItem[] {
  const at0 = layout.findIndex((x) => x.id === id);
  if (at0 < 0 || isLocked(kind, id)) return layout;
  // at0 已判 ≥0：取到的必是这一项
  const item = { ...layout[at0]! };
  if (visible !== undefined) {
    if (metaOf(kind, id).noHide) item.visible = true;
    else item.visible = !!visible;
  }
  const rest = layout.filter((_, i) => i !== at0);
  let at: number;
  if (anchorId === id) {
    at = at0;
  } else if (anchorId) {
    const ai = rest.findIndex((x) => x.id === anchorId);
    at = ai < 0 ? rest.length : ai + (after ? 1 : 0);
  } else {
    // 无锚点：插到工具栏可见段末（「更多」入口之前若存在）
    const moreAt = rest.findIndex((x) => x.id === 'more');
    at = moreAt >= 0 ? moreAt : rest.length;
  }
  const floor = rest.findIndex((x) => isLocked(kind, x.id));
  if (floor >= 0 && at > floor) at = floor;
  const next = rest.slice();
  next.splice(at, 0, item);
  return next;
}

/** 段内邻居挪动（↑↓ / Alt+方向键兜底） */
export function nudgeModule(kind: string, layout: LayoutItem[], id: string, dir: number): LayoutItem[] {
  const bar = layout.filter((x) => onBarOf(kind, x) && !isLocked(kind, x.id));
  const i = bar.findIndex((x) => x.id === id);
  if (i < 0) return layout;
  const j = i + dir;
  if (j < 0 || j >= bar.length) return layout;
  // j 已在界内：锚点必非空
  const anchor = bar[j]!;
  return moveModule(kind, layout, {
    id,
    anchorId: anchor.id,
    after: dir > 0,
  });
}
