// 拓扑就绪（自 localtask/dag.js 下沉）。任务行与快照节点两套入口。

/** 规范化 blockBy：正整数 id、去重、丢掉自身 */
export function normalizeBlockBy(raw, selfId) {
  const self = Number(selfId);
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (Number.isFinite(self) && n === self) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
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
 * 某条 pending 现在能不能领（任务行模型）。
 * @param {object} task
 * @param {object[]} all
 */
export function isReadyToClaim(task, all = []) {
  if (!isPendingLike(task)) return false;
  const byId = new Map((all || []).filter(isAlive).map((t) => [Number(t.id), t]));

  const deps = normalizeBlockBy(task.blockBy, task.id);
  for (const id of deps) {
    const dep = byId.get(id);
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

/** 按数组序找第一条可领取的 pending；没有 → null */
export function findFirstReadyPending(tasks = []) {
  for (const t of tasks || []) {
    if (isReadyToClaim(t, tasks)) return t;
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
