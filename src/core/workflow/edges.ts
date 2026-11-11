import { edgesFromTasks } from './types.js';
import type { WorkflowSnapshot } from './types.js';

export { edgesFromTasks };

/**
 * 从快照边表收集某节点的前驱 id。
 */
export function predecessorsOf(snap: WorkflowSnapshot, nodeId: string | number): Array<string | number> {
  const id = String(nodeId);
  const out: Array<string | number> = [];
  for (const e of snap?.edges || []) {
    if (String(e.to) === id) out.push(e.from);
  }
  return out;
}

/**
 * 某节点的后继 id。
 */
export function successorsOf(snap: WorkflowSnapshot, nodeId: string | number): Array<string | number> {
  const id = String(nodeId);
  const out: Array<string | number> = [];
  for (const e of snap?.edges || []) {
    if (String(e.from) === id) out.push(e.to);
  }
  return out;
}
