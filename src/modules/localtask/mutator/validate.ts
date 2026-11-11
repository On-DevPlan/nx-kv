import { assertPluginSpec } from '../../../core/workflow/plugin-registry.js';
import { isGateNode } from '../../../core/workflow/types.js';
import { wouldCycleAfterLink } from '../../../shared/graph.js';
import type { WorkflowSnapshot, WfNode, PluginSpec } from '../../../core/workflow/types.js';

/** assertPluginSpec 归一化后的插件规格（原样透传，不收紧）。 */
type NormalizedSpec = ReturnType<typeof assertPluginSpec>;

export function findNode(snap: WorkflowSnapshot, id: unknown): WfNode | null {
  return (snap.nodes || []).find((n) => String(n.id) === String(id)) || null;
}

/** assertEdge 的选项。 */
export interface AssertEdgeOptions {
  requireNodes?: boolean;
}

/** 禁止自环；from/to 须存在（可选严格） */
export function assertEdge(snap: WorkflowSnapshot, from: unknown, to: unknown, { requireNodes = true }: AssertEdgeOptions = {}): void {
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
export function assertBind(node: WfNode | null, spec: PluginSpec, target: 'node' | 'workflow'): NormalizedSpec {
  const normalized = assertPluginSpec(spec);
  if (target === 'workflow') {
    if (normalized.scope !== 'workflow') {
      throw new Error(`workflow plugin must have scope=workflow, got ${normalized.scope}`);
    }
    return normalized;
  }
  if (!node) throw new Error('node required for node-level bind');
  if (isGateNode(node) && normalized.scope !== 'control') {
    throw new Error('control node may only bind control-scope plugins');
  }
  // task + control 插件：允许，由 mutator 升级 kind→control（现网闸门常从普通任务打 --gate）
  return normalized;
}

export function wouldCreateCycle(snap: WorkflowSnapshot, from: unknown, to: unknown): boolean {
  // 加边 from→to 成环 ⟺ to ⇝ from（沿快照正向边）——实现下沉 src/shared/graph.js
  const adj = new Map<string, string[]>();
  for (const e of snap.edges || []) {
    const a = String(e.from);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(String(e.to));
  }
  // 原 .js 就把任意节点 id 直传（运行时是 number）：此处按原语义断言到 string | number
  return wouldCycleAfterLink((n) => adj.get(String(n)) || [], from as string | number, to as string | number);
}
