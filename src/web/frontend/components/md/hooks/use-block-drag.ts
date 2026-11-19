// 实时预览的**块拖拽排序**（对齐 BlockNote / Notion 的侧栏把手）：
// 把手在 block-rail 里，落点判定与指示线在这里——一处 dragOver 处理整张列表，
// 不必给每个块挂一遍处理器。
//
// 落点语义：指针落在目标块的**上半**→插到它之前，下半→插到它之后；
// 换算成 moveBlockInList 的下标时要扣掉「源块先被抽走」这一格。
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

/** 拖拽落点：目标块序号 + 落在它的哪条边。 */
export interface BlockDropAt {
  index: number;
  edge: 'before' | 'after';
}

/**
 * @param onMove 目标下标语义同 moveBlockInList（移动后占 to 位）
 */
export function useBlockDrag(onMove: (from: number, to: number) => void) {
  // 拖拽源下标放 ref 而不是 state：dragstart 里写、dragover 里读，
  // 期间不需要重渲染（重渲染反而会让被拖的节点重建、拖拽中断）。
  const dragIndexRef = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<BlockDropAt | null>(null);

  const clear = () => {
    dragIndexRef.current = null;
    setDropAt(null);
  };

  const blockOf = (target: EventTarget | null): HTMLElement | null => {
    const el = (target as Element | null)?.closest?.('.mdw-lp-block');
    return (el as HTMLElement | null) ?? null;
  };

  const listProps = {
    onDragOver(e: DragEvent<HTMLDivElement>) {
      if (dragIndexRef.current == null) return;
      const el = blockOf(e.target);
      if (!el) return;
      const idx = Number(el.getAttribute('data-i'));
      if (!Number.isInteger(idx)) return;
      // preventDefault 是「允许放下」的唯一开关，缺了它 drop 永远不触发
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const edge: BlockDropAt['edge'] = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setDropAt((cur) => (cur && cur.index === idx && cur.edge === edge ? cur : { index: idx, edge }));
    },
    onDragLeave(e: DragEvent<HTMLDivElement>) {
      // DOM 事件边界：relatedTarget 声明为 EventTarget，contains 需要 Node
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
    },
    onDrop(e: DragEvent<HTMLDivElement>) {
      const from = dragIndexRef.current;
      const at = dropAt;
      clear();
      if (from == null || !at) return;
      e.preventDefault();
      // 插到 after 处 = 目标块原下标 + 1；源块在目标之前时先被抽走，整体左移一格
      let to = at.edge === 'before' ? at.index : at.index + 1;
      if (from < to) to -= 1;
      if (to !== from) onMove(from, to);
    },
    onDragEnd: clear,
  };

  return { dragIndexRef, dropAt, listProps };
}
