// 编排画布的连线几何：贝塞尔路径、屏幕 → 画布坐标换算、边端点计算。
import { NODE_W } from './layout.js';
import { depToNodeKey } from './model.js';
import type { DagNode, DagPoint, DagPosMap } from './model.js';

/** 一条有向边的端点（画布坐标）。 */
export interface DagEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 量节点实际高度：调用方注入（要读 DOM），几何层保持纯函数。 */
export type HeightOf = (nodeKey: string) => number;

export function cubic(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function canvasPoint(canvas: HTMLElement, clientX: number, clientY: number): DagPoint {
  const base = canvas.getBoundingClientRect();
  return {
    x: clientX - base.left + canvas.scrollLeft,
    y: clientY - base.top + canvas.scrollTop,
  };
}

/** 节点出栈口的画布坐标（节点右缘中点）；heightOf 量节点实际高（未知按 64） */
export function portOriginOf(
  canvas: HTMLElement | null,
  pos: DagPosMap,
  nk: string,
  heightOf: HeightOf,
): DagPoint {
  const p = pos.get(nk) || { x: 0, y: 0 };
  return { x: p.x + NODE_W, y: p.y + heightOf(nk) / 2 };
}

/**
 * 由 blockBy 依赖算出全部有向边的端点。
 * heightOf(nodeKey) 由调用方注入（要读 DOM 的 offsetHeight，这里保持纯函数）。
 *
 * 方向自适应（#153）：目标在源右侧 → 源右缘出、目标左缘入；否则反向
 * （同列纵向依赖、用户把节点拖到左边时，线不再绕回去打结）。
 */
export function computeEdges(
  nodes: DagNode[],
  pos: DagPosMap,
  byNodeKey: Map<string, DagNode>,
  heightOf: HeightOf,
): DagEdge[] {
  const out: DagEdge[] = [];
  for (const n of nodes) {
    const b = pos.get(n.nodeKey);
    if (!b) continue;
    const hTo = heightOf(n.nodeKey);
    for (const d of n.blockBy || []) {
      const fromKey = depToNodeKey(d, n.topicKey);
      if (!fromKey || !byNodeKey.has(fromKey)) continue;
      const a = pos.get(fromKey);
      if (!a) continue;
      const hFrom = heightOf(fromKey);
      const toRight = b.x > a.x + NODE_W - 8;
      out.push({
        from: fromKey,
        to: n.nodeKey,
        x1: toRight ? a.x + NODE_W : a.x,
        y1: a.y + hFrom / 2,
        x2: toRight ? b.x : b.x + NODE_W,
        y2: b.y + hTo / 2,
      });
    }
  }
  return out;
}
