import { assertPluginSpec } from '../../../core/workflow/plugin-registry.js';

/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */
/** @typedef {import('../../../core/workflow/types.js').WfNode} WfNode */
/** @typedef {import('../../../core/workflow/types.js').PluginSpec} PluginSpec */

export function findNode(snap, id) {
  return (snap.nodes || []).find((n) => String(n.id) === String(id)) || null;
}

/** 禁止自环；from/to 须存在（可选严格） */
export function assertEdge(snap, from, to, { requireNodes = true } = {}) {
  if (String(from) === String(to)) throw new Error('self-loop edge forbidden');
  if (requireNodes) {
    if (!findNode(snap, from)) throw new Error(`edge.from missing node: ${from}`);
    if (!findNode(snap, to)) throw new Error(`edge.to missing node: ${to}`);
  }
}

/**
 * control 节点只能绑 control scope；task 不能绑 control；workflow 级只能挂根。
 * @param {WfNode | null} node
 * @param {PluginSpec} spec
 * @param {'node'|'workflow'} target
 */
export function assertBind(node, spec, target) {
  const normalized = assertPluginSpec(spec);
  if (target === 'workflow') {
    if (normalized.scope !== 'workflow') {
      throw new Error(`workflow plugin must have scope=workflow, got ${normalized.scope}`);
    }
    return normalized;
  }
  if (!node) throw new Error('node required for node-level bind');
  if (node.kind === 'control' && normalized.scope !== 'control') {
    throw new Error('control node may only bind control-scope plugins');
  }
  // task + control 插件：允许，由 mutator 升级 kind→control（现网闸门常从普通任务打 --gate）
  return normalized;
}

export function wouldCreateCycle(snap, from, to) {
  // DFS：从 to 能否走到 from
  const adj = new Map();
  for (const e of snap.edges || []) {
    const a = String(e.from);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(String(e.to));
  }
  const start = String(to);
  const target = String(from);
  const stack = [start];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) || []) stack.push(n);
  }
  return false;
}
