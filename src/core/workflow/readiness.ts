// 拓扑就绪（自 localtask/dag.js 下沉）。任务行与快照节点两套入口，**一个内核**：
// 任务行先投影成轻量图（taskToNode + edgesFromTasks），本地依赖与闸门判定直接
// 复用 isNodeReady——两个模型对同一份数据产出同一张图，结论必然一致
// （一致性由 tests/unit/readiness-consistency.test.mjs 钉死）。
//
// blockBy 支持：
//   - 本地 id（number）——同队列依赖（兼容旧存盘）；入图，走内核判定
//   - 跨队列引用 `"<topicKey>:<taskId>"`——组编排跨项目边；不入引擎图
//     （edgesFromTasks 跳过），由 resolveForeign 前置直查，fail-open

import { edgesFromTasks, taskToNode, isGateNode } from './types.js';
import type { WfEdge, WfNode } from './types.js';

/** topicKey:id —— key 允许字母数字与 _-（含 __GLOBAL__） */
const FOREIGN_RE = /^([A-Za-z0-9_-]+):(\d+)$/;

export type DepRef = { kind: 'local'; id: number } | { kind: 'foreign'; key: string; id: number };

/**
 * 解析单条依赖引用。
 */
export function parseDepRef(x?: unknown): DepRef | null {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) {
    return { kind: 'local', id: Math.trunc(x) };
  }
  const s = String(x ?? '').trim();
  if (!s) return null;
  const m = FOREIGN_RE.exec(s);
  if (m) return { kind: 'foreign', key: m[1] ?? '', id: Number(m[2]) };
  // 纯数字字符串 → 本地 id（避免把 "12" 当 foreign）
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return { kind: 'local', id: n };
  }
  return null;
}

export function formatDepRef(ref?: DepRef | null): number | string {
  if (!ref) return '';
  if (ref.kind === 'foreign') return `${ref.key}:${ref.id}`;
  return ref.id;
}

/**
 * 规范化 blockBy：本地正整数 id + 跨队列 "key:id"、去重、丢掉本地自身。
 */
export function normalizeBlockBy(raw?: unknown, selfId?: number | string): Array<number | string> {
  const self = Number(selfId);
  const seen = new Set<string>();
  const out: Array<number | string> = [];

  let items: unknown[] = [];
  if (raw == null || raw === '') items = [];
  else if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string' && /[,，\s]/.test(raw) && !FOREIGN_RE.test(raw.trim())) {
    items = raw.split(/[,，\s]+/).filter(Boolean);
  } else {
    items = [raw];
  }

  // 数组元素里也可能是逗号串（HTTP 偶发）
  const flat: unknown[] = [];
  for (const x of items) {
    if (typeof x === 'string' && /[,，]/.test(x) && !FOREIGN_RE.test(x.trim())) {
      flat.push(...x.split(/[,，\s]+/).filter(Boolean));
    } else {
      flat.push(x);
    }
  }

  for (const x of flat) {
    const ref = parseDepRef(x);
    if (!ref) continue;
    if (ref.kind === 'local') {
      if (Number.isFinite(self) && ref.id === self) continue;
      const token = String(ref.id);
      if (seen.has(`L:${token}`)) continue;
      seen.add(`L:${token}`);
      out.push(ref.id);
    } else {
      const token = `${ref.key}:${ref.id}`;
      if (seen.has(`F:${token}`)) continue;
      seen.add(`F:${token}`);
      out.push(token);
    }
  }
  return out;
}

function isAlive(t: any): boolean {
  return t && !t.deletedAt && !t.migratedTo;
}

/**
 * 已完成口径（终态：**done / cancelled** 都算）。
 *
 * 为什么 cancelled 也算：旧口径里「归档（archived）」既不是交付也不是在干，
 * 但是**终态**——它不会再动了，依赖它的人不该被永久挡住（#59）。
 * 新词表把这种终态拆成 done / cancelled 两个词，判据随之覆盖两者。
 * 词表权威见 src/shared/task-status.js（core 层不得 import shared，故此处内联）。
 */
function isCompleted(t: any): boolean {
  return isAlive(t) && (!!t.completedAt || t.status === 'done' || t.status === 'cancelled');
}

/**
 * 待领取口径：**正判定** —— 只有 `pending` 且活着。
 *
 * 以前是排除法（不是 consumed、不是 archived 就算待领取），语义是
 * 「不认识的一律当可领」：任何新状态/漏迁移的行都会被派给 agent 重干一遍，且不报错。
 * 改成正判定后，不认识的词一律不算待领取（宁可少派，不可多派）。
 */
function isPendingLike(t: any): boolean {
  return isAlive(t) && t.status === 'pending';
}

export interface ReadyOpts {
  /** 跨队列依赖解析；缺席或返回空 = fail-open（挡不住） */
  resolveForeign?: (topicKey: string, taskId: number) => object | null | undefined;
}

/** 跨队列依赖是否未满足（true = 挡）。无解析器 / 解析不到 / 已删已迁 → fail-open 不挡。 */
function foreignBlocked(task: any, opts: ReadyOpts): boolean {
  for (const d of normalizeBlockBy(task.blockBy, task.id)) {
    const ref = parseDepRef(d);
    if (!ref || ref.kind !== 'foreign') continue;
    const resolveForeign = opts?.resolveForeign;
    if (typeof resolveForeign !== 'function') continue;
    const found = resolveForeign(ref.key, ref.id);
    const dep = found && isAlive(found) ? found : null;
    if (dep && !isCompleted(dep)) return true;
  }
  return false;
}

/** isNodeReady 只读 nodes / edges：任务行模型的「轻量图」与完整快照都满足。 */
export interface WfGraph {
  nodes?: WfNode[];
  edges?: WfEdge[];
}

/**
 * 任务行 → 轻量图（与 topicToSnapshot 同源：taskToNode 投影节点、edgesFromTasks 产边）。
 * blockBy 先过 normalizeBlockBy（去自身/去非法，与引擎写入路径同一口径）再产边；
 * "key:id" 外部边不入图。这是两个模型共用的唯一边源。
 */
function rowsGraph(tasks: any[]): { nodes: WfNode[]; edges: WfEdge[] } {
  const alive = (tasks || []).filter(isAlive).map((t) => ({
    ...t,
    blockBy: normalizeBlockBy(t.blockBy, t.id),
  }));
  return { nodes: alive.map(taskToNode), edges: edgesFromTasks(alive) };
}

/** 图上判定：目标节点缺位（不在 all 里）→ true；否则交给 isNodeReady 内核。 */
function readyInGraph(graph: WfGraph, taskId: string | number): boolean {
  const node = (graph.nodes || []).find((n) => String(n.id) === String(taskId));
  if (!node) return true;
  return isNodeReady(graph, node);
}

/**
 * 某条 pending 现在能不能领（任务行模型）。
 * 本地依赖 + 闸门走快照同一内核（isNodeReady）；跨队列依赖走 resolveForeign 前置直查。
 * 前驱判定口径：completedAt ⇔ 节点 success（taskToNode 映射），闸门 = control 屏障。
 */
export function isReadyToClaim(task: any, all: any[] = [], opts: ReadyOpts = {}): boolean {
  if (!isPendingLike(task)) return false;
  if (foreignBlocked(task, opts)) return false;
  return readyInGraph(rowsGraph(all), task.id);
}

/**
 * 按数组序找第一条可领取的 pending；没有 → null。
 * 图一次构建逐条判定（结论与逐条 isReadyToClaim 相同，省掉每条重建图）。
 */
export function findFirstReadyPending(tasks: any[] = [], opts: ReadyOpts = {}): any {
  const list = tasks || [];
  const graph = rowsGraph(list);
  for (const t of list) {
    if (!isPendingLike(t)) continue;
    if (foreignBlocked(t, opts)) continue;
    const node = graph.nodes.find((n) => String(n.id) === String(t.id));
    if (!node || isNodeReady(graph, node)) return t;
  }
  return null;
}

/**
 * 快照节点是否就绪（边 + control/blockgoal 前驱须 success）。
 */
export function isNodeReady(
  snap: WfGraph,
  node: WfNode,
  isBarrierOpen?: (snap: WfGraph, nodeId: string | number) => boolean,
): boolean {
  if (!node || node.state === 'success' || node.state === 'failed' || node.state === 'running') {
    return false;
  }
  if (node.state !== 'pending' && node.state !== 'ready') return false;

  const preds = (snap.edges || []).filter((e) => String(e.to) === String(node.id));
  const byId = new Map((snap.nodes || []).map((n): [string, WfNode] => [String(n.id), n]));

  for (const e of preds) {
    const pred = byId.get(String(e.from));
    if (!pred) continue;
    if (isGateNode(pred)) {
      const open = isBarrierOpen
        ? isBarrierOpen(snap, pred.id)
        : pred.state === 'success';
      if (!open) return false;
      continue;
    }
    if (pred.state !== 'success') return false;
  }
  return true;
}
