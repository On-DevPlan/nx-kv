// 主题队列（localtask topic.tasks）↔ WorkflowSnapshot 双向投影。
// 存盘形状仍是任务行；快照是引擎视图。正文不进快照（payload.textRef）。
// 跨队列 blockBy（"topicKey:id"）不进引擎边，投影回写时必须保留。

import { edgesFromTasks, isGateNode, taskToNode } from './types.js';
import type { WfNode, WorkflowSnapshot } from './types.js';
import { normalizeBlockBy, parseDepRef } from './readiness.js';

/** 投影出的快照额外带 meta（契约 typedef 未列，但 topicToSnapshot 一直写它）。 */
export type TopicSnapshot = WorkflowSnapshot & { meta: { cwd: string; name: string } };

/**
 * @param {object} topic  localtask 主题桶
 */
export function topicToSnapshot(topic: any): TopicSnapshot {
  const workflowId = String(topic?.key || topic?.workflowId || '');
  const tasks = Array.isArray(topic?.tasks) ? topic.tasks : [];
  const nodes = tasks.filter((t: any) => t && !t.deletedAt && !t.migratedTo).map(taskToNode);
  const edges = edgesFromTasks(tasks);
  const revision = Number(topic?.workflowRevision) || 0;
  return {
    workflowId,
    state: topic?.workflowState || 'active',
    nodes,
    edges,
    workflowPlugins: Array.isArray(topic?.workflowPlugins) ? topic.workflowPlugins : [],
    revision,
    updatedAt: topic?.updatedAt || new Date().toISOString(),
    meta: {
      cwd: topic?.cwd || '',
      name: topic?.name || '',
    },
  };
}

/**
 * 把快照写回主题任务行（保守：不改 text；按 id 对齐）。
 */
export function applySnapshotToTopic(topic: any, snap: WorkflowSnapshot): any {
  if (!topic || !snap) return topic;
  const tasks = Array.isArray(topic.tasks) ? topic.tasks : (topic.tasks = []);
  const byId = new Map<string, any>(tasks.map((t: any): [string, any] => [String(t.id), t]));

  for (const node of snap.nodes || []) {
    let task = byId.get(String(node.id));
    if (!task) {
      // 引擎新建的节点 → 补一条占位任务（正文外置占位）
      task = {
        id: Number(node.id) || node.id,
        text: '',
        status: 'pending',
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        completedAt: '',
        deletedAt: '',
        blockBy: [],
        blocksFollowing: false,
      };
      tasks.push(task);
      byId.set(String(task.id), task);
    }
    syncTaskFromNode(task, node);
  }

  // 边 → blockBy（显式依赖）；闸门边由 blocksFollowing 表达，不写进每条 blockBy。
  // 本地依赖取「现有 ∪ 快照边」的**并集**而不是按边重建：快照可能滞后于外部任务行写
  // （引擎在途写），按边重建会把外部刚设好的 blockBy 洗掉。依赖是「只能多、不能凭空少」
  // 的保守口径——解除依赖一律走外部 clear 先落盘，再由 syncTaskDagUpdate 拆边，
  // 不存在「只删引擎边、不删任务行」的路径，所以并集不会让解除失效。
  const gateIds = new Set(
    (snap.nodes || []).filter((n) => isGateNode(n)).map((n) => String(n.id)),
  );

  for (const task of tasks) {
    if (task.deletedAt || task.migratedTo) continue;
    const keep = normalizeBlockBy(task.blockBy, task.id);
    const keepForeign = keep.filter((d) => parseDepRef(d)?.kind === 'foreign');
    const keepLocal = keep.filter((d) => parseDepRef(d)?.kind === 'local');
    const incoming = (snap.edges || []).filter((e) => String(e.to) === String(task.id));
    const localDeps: number[] = [];
    for (const e of incoming) {
      // 跳过「闸门挡后续」推出来的边：from 是闸门且闸门在数组序上早于本任务时由 blocksFollowing 覆盖
      if (gateIds.has(String(e.from))) continue;
      const n = Number(e.from);
      if (Number.isFinite(n) && n > 0) localDeps.push(n);
    }
    task.blockBy = normalizeBlockBy([...keepLocal, ...localDeps, ...keepForeign], task.id);
  }

  topic.workflowRevision = Number(snap.revision) || 0;
  topic.workflowState = snap.state || 'active';
  topic.workflowPlugins = Array.isArray(snap.workflowPlugins) ? snap.workflowPlugins : [];
  if (snap.updatedAt) topic.updatedAt = snap.updatedAt;
  return topic;
}

function syncTaskFromNode(task: any, node: WfNode): void {
  task.blocksFollowing = isGateNode(node);

  if (node.state === 'success') {
    if (!task.completedAt) {
      task.completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    }
  } else if (node.state === 'running' && task.status !== 'claimed') {
    // 词表见 src/shared/task-status.js：claimed = 已领取、还没交付
    task.status = 'claimed';
  }
  // pending/ready：不改 status（领取态由 wait/get 管；ready 由 isReadyToClaim 现算）
}
