import { isNodeReady } from '../../../core/workflow/readiness.js';
import { isBarrierOpen } from '../../tasktool/plugins/blockgoal.js';

/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */

/**
 * 一轮调度：pending→ready（不自动进 running；running 由业务/领取侧推进）。
 * @param {WorkflowSnapshot} snap
 * @returns {{ changed: boolean, readyIds: Array<string|number> }}
 */
export function driveReadyStates(snap) {
  const readyIds = [];
  let changed = false;
  for (const node of snap.nodes || []) {
    if (node.state !== 'pending' && node.state !== 'ready') continue;
    const ok = isNodeReady(snap, node, isBarrierOpen);
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
