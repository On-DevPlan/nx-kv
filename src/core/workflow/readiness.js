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

/** topicKey:id —— key 允许字母数字与 _-（含 __GLOBAL__） */
const FOREIGN_RE = /^([A-Za-z0-9_-]+):(\d+)$/;

/**
 * @typedef {{ kind: 'local', id: number } | { kind: 'foreign', key: string, id: number }} DepRef
 */

/**
 * 解析单条依赖引用。
 * @param {unknown} x
 * @returns {DepRef | null}
 */
export function parseDepRef(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) {
    return { kind: 'local', id: Math.trunc(x) };
  }
  const s = String(x ?? '').trim();
  if (!s) return null;
  const m = FOREIGN_RE.exec(s);
  if (m) return { kind: 'foreign', key: m[1], id: Number(m[2]) };
  // 纯数字字符串 → 本地 id（避免把 "12" 当 foreign）
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return { kind: 'local', id: n };
  }
  return null;
}

/** @param {DepRef} ref @returns {number|string} */
export function formatDepRef(ref) {
  if (!ref) return '';
  if (ref.kind === 'foreign') return `${ref.key}:${ref.id}`;
  return ref.id;
}

/**
 * 规范化 blockBy：本地正整数 id + 跨队列 "key:id"、去重、丢掉本地自身。
 * @param {unknown} raw
 * @param {number|string} [selfId]
 * @returns {Array<number|string>}
 */
export function normalizeBlockBy(raw, selfId) {
  const self = Number(selfId);
  const seen = new Set();
  const out = [];

  /** @type {unknown[]} */
  let items = [];
  if (raw == null || raw === '') items = [];
  else if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string' && /[,，\s]/.test(raw) && !FOREIGN_RE.test(raw.trim())) {
    items = raw.split(/[,，\s]+/).filter(Boolean);
  } else {
    items = [raw];
  }

  // 数组元素里也可能是逗号串（HTTP 偶发）
  const flat = [];
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

function isAlive(t) {
  return t && !t.deletedAt && !t.migratedTo;
}

/**
 * 已完成口径。**归档（archived）也算完成**——归档是终态：它不会再动，
 * 依赖它的人不该永远被挡着（#59）。
 */
function isCompleted(t) {
  return isAlive(t) && (!!t.completedAt || t.status === 'archived');
}

/**
 * 待领取口径：活着（没删没迁出）且不是「已领走」。
 * **归档（archived）也不算待领取**——归档是终态：状态单向，没有回退边（#59）。
 */
function isPendingLike(t) {
  return isAlive(t) && t.status !== 'consumed' && t.status !== 'archived';
}

/**
 * @typedef {object} ReadyOpts
 * @property {(topicKey: string, taskId: number) => object|null|undefined} [resolveForeign]
 *   跨队列依赖解析；缺席或返回空 = fail-open（挡不住）
 */

/** 跨队列依赖是否未满足（true = 挡）。无解析器 / 解析不到 / 已删已迁 → fail-open 不挡。 */
function foreignBlocked(task, opts) {
  for (const d of normalizeBlockBy(task.blockBy, task.id)) {
    const ref = parseDepRef(d);
    if (!ref || ref.kind !== 'foreign') continue;
    if (typeof opts?.resolveForeign !== 'function') continue;
    const found = opts.resolveForeign(ref.key, ref.id);
    const dep = found && isAlive(found) ? found : null;
    if (dep && !isCompleted(dep)) return true;
  }
  return false;
}

/**
 * 任务行 → 轻量图（与 topicToSnapshot 同源：taskToNode 投影节点、edgesFromTasks 产边）。
 * blockBy 先过 normalizeBlockBy（去自身/去非法，与引擎写入路径同一口径）再产边；
 * "key:id" 外部边不入图。这是两个模型共用的唯一边源。
 * @param {object[]} tasks
 * @returns {{ nodes: import('./types.js').WfNode[], edges: import('./types.js').WfEdge[] }}
 */
function rowsGraph(tasks) {
  const alive = (tasks || []).filter(isAlive).map((t) => ({
    ...t,
    blockBy: normalizeBlockBy(t.blockBy, t.id),
  }));
  return { nodes: alive.map(taskToNode), edges: edgesFromTasks(alive) };
}

/** 图上判定：目标节点缺位（不在 all 里）→ true；否则交给 isNodeReady 内核。 */
function readyInGraph(graph, taskId) {
  const node = (graph.nodes || []).find((n) => String(n.id) === String(taskId));
  if (!node) return true;
  return isNodeReady(graph, node);
}

/**
 * 某条 pending 现在能不能领（任务行模型）。
 * 本地依赖 + 闸门走快照同一内核（isNodeReady）；跨队列依赖走 resolveForeign 前置直查。
 * 前驱判定口径：completedAt ⇔ 节点 success（taskToNode 映射），闸门 = control 屏障。
 * @param {object} task
 * @param {object[]} all
 * @param {ReadyOpts} [opts]
 */
export function isReadyToClaim(task, all = [], opts = {}) {
  if (!isPendingLike(task)) return false;
  if (foreignBlocked(task, opts)) return false;
  return readyInGraph(rowsGraph(all), task.id);
}

/**
 * 按数组序找第一条可领取的 pending；没有 → null。
 * 图一次构建逐条判定（结论与逐条 isReadyToClaim 相同，省掉每条重建图）。
 * @param {object[]} tasks
 * @param {ReadyOpts} [opts]
 */
export function findFirstReadyPending(tasks = [], opts = {}) {
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
 * @param {import('./types.js').WorkflowSnapshot} snap
 * @param {import('./types.js').WfNode} node
 * @param {(snap: import('./types.js').WorkflowSnapshot, nodeId: string|number) => boolean} [isBarrierOpen]
 */
export function isNodeReady(snap, node, isBarrierOpen) {
  if (!node || node.state === 'success' || node.state === 'failed' || node.state === 'running') {
    return false;
  }
  if (node.state !== 'pending' && node.state !== 'ready') return false;

  const preds = (snap.edges || []).filter((e) => String(e.to) === String(node.id));
  const byId = new Map((snap.nodes || []).map((n) => [String(n.id), n]));

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
