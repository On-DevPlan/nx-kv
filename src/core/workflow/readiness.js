// 拓扑就绪（自 localtask/dag.js 下沉）。任务行与快照节点两套入口。
//
// blockBy 支持：
//   - 本地 id（number）——同队列依赖（兼容旧存盘）
//   - 跨队列引用 `"<topicKey>:<taskId>"`——组编排跨项目边；get 时跨 topic 解析

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

function isCompleted(t) {
  return isAlive(t) && !!t.completedAt;
}

function isPendingLike(t) {
  return isAlive(t) && t.status !== 'consumed';
}

/**
 * @typedef {object} ReadyOpts
 * @property {(topicKey: string, taskId: number) => object|null|undefined} [resolveForeign]
 *   跨队列依赖解析；缺席或返回空 = fail-open（挡不住）
 */

/**
 * 某条 pending 现在能不能领（任务行模型）。
 * @param {object} task
 * @param {object[]} all
 * @param {ReadyOpts} [opts]
 */
export function isReadyToClaim(task, all = [], opts = {}) {
  if (!isPendingLike(task)) return false;
  const byId = new Map((all || []).filter(isAlive).map((t) => [Number(t.id), t]));

  const deps = normalizeBlockBy(task.blockBy, task.id);
  for (const d of deps) {
    const ref = parseDepRef(d);
    if (!ref) continue;
    let dep = null;
    if (ref.kind === 'local') {
      dep = byId.get(ref.id) || null;
    } else if (typeof opts.resolveForeign === 'function') {
      const found = opts.resolveForeign(ref.key, ref.id);
      dep = found && isAlive(found) ? found : null;
    } else {
      // 无解析器：跨队列依赖无法验证 → fail-open（与「依赖缺失」同口径）
      continue;
    }
    if (!dep) continue;
    if (!isCompleted(dep)) return false;
  }

  const idx = (all || []).indexOf(task);
  const order = all || [];
  const myPos = idx >= 0 ? idx : order.findIndex((t) => Number(t.id) === Number(task.id));
  if (myPos < 0) return true;
  for (let i = 0; i < myPos; i += 1) {
    const prev = order[i];
    if (!isAlive(prev) || !prev.blocksFollowing) continue;
    if (!isCompleted(prev)) return false;
  }
  return true;
}

/**
 * 按数组序找第一条可领取的 pending；没有 → null
 * @param {object[]} tasks
 * @param {ReadyOpts} [opts]
 */
export function findFirstReadyPending(tasks = [], opts = {}) {
  for (const t of tasks || []) {
    if (isReadyToClaim(t, tasks, opts)) return t;
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
    const isControl =
      pred.kind === 'control' ||
      (pred.plugins || []).some((p) => p.name === 'blockgoal' || p.scope === 'control');
    if (isControl) {
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
