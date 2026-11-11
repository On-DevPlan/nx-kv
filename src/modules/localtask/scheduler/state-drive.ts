import { isNodeReady } from '../../../core/workflow/readiness.js';
import type { WfGraph } from '../../../core/workflow/readiness.js';
import { isBarrierOpen } from '../../tasktool/plugins/blockgoal.js';
import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

/** driveReadyStates 的出站形状。 */
export interface DriveResult {
  changed: boolean;
  readyIds: Array<string | number>;
}

/**
 * 一轮调度：pending→ready（不自动进 running；running 由业务/领取侧推进）。
 * @param {WorkflowSnapshot} snap
 * @returns {{ changed: boolean, readyIds: Array<string|number> }}
 */
export function driveReadyStates(snap: WorkflowSnapshot): DriveResult {
  const readyIds: Array<string | number> = [];
  let changed = false;
  for (const node of snap.nodes || []) {
    if (node.state !== 'pending' && node.state !== 'ready') continue;
    // isBarrierOpen 的入参刻意更宽（可空快照 / unknown id）：isNodeReady 只传 (WfGraph, id)，
    // 运行时安全，按实际调用形状断言
    const ok = isNodeReady(snap, node, isBarrierOpen as (snap: WfGraph, nodeId: string | number) => boolean);
    if (ok && node.state !== 'ready') {
      node.state = 'ready';
      changed = true;
      readyIds.push(node.id);
    } else if (!ok && node.state === 'ready') {
      // 动态加回屏障 → 退回 pending
      node.state = 'pending';
      changed = true;
    } else if (ok) {
      readyIds.push(node.id);
    }
  }
  return { changed, readyIds };
}
