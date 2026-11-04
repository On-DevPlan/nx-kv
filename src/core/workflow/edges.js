import { edgesFromTasks } from './types.js';

export { edgesFromTasks };

/**
 * 从快照边表收集某节点的前驱 id。
 * @param {import('./types.js').WorkflowSnapshot} snap
 * @param {string|number} nodeId
 */
export function predecessorsOf(snap, nodeId) {
  const id = String(nodeId);
  const out = [];
  for (const e of snap?.edges || []) {
    if (String(e.to) === id) out.push(e.from);
  }
  return out;
}

/**
 * 某节点的后继 id。
 * @param {import('./types.js').WorkflowSnapshot} snap
 * @param {string|number} nodeId
 */
export function successorsOf(snap, nodeId) {
  const id = String(nodeId);
  const out = [];
  for (const e of snap?.edges || []) {
    if (String(e.from) === id) out.push(e.to);
  }
  return out;
}
