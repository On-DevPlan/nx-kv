// 编排面板的任务/依赖纯逻辑：节点键、依赖 token 解析、待领取判定。
import { titleFromMd } from '../../modules/md/md-parse.js';
import { taskLabel } from '../../components/sidebar/model.js';

export function isAlive(t) {
  return t && !t.deletedAt && !t.migratedTo;
}

// 正判定：只有 pending 可领（与 shared/task-status.js 的 isPending 同口径）。
// 排除法时代「不认识的状态一律当可领」，会把已交付的任务画进待领取图里。
export function isPending(t) {
  return isAlive(t) && t.status === 'pending';
}

export function labelOf(t) {
  return titleFromMd(t.text) || taskLabel(t) || `#${t.id}`;
}

export function nodeKeyOf(topicKey, id) {
  return `${topicKey}:${Number(id)}`;
}

/** @returns {{ kind:'local', id:number } | { kind:'foreign', key:string, id:number } | null} */
export function parseDep(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return { kind: 'local', id: Math.trunc(x) };
  const s = String(x ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z0-9_-]+):(\d+)$/.exec(s);
  if (m) return { kind: 'foreign', key: m[1], id: Number(m[2]) };
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 0) return { kind: 'local', id: n };
  }
  return null;
}

export function depToNodeKey(dep, ownerTopicKey) {
  const ref = parseDep(dep);
  if (!ref) return null;
  if (ref.kind === 'foreign') return nodeKeyOf(ref.key, ref.id);
  return nodeKeyOf(ownerTopicKey, ref.id);
}

export function formatDepForTarget(sourceNode, targetTopicKey) {
  if (sourceNode.topicKey === targetTopicKey) return Number(sourceNode.id);
  return nodeKeyOf(sourceNode.topicKey, sourceNode.id);
}
