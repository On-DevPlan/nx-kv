// 日常 DAG 写路径 —— 一律经 Mutator（单一写入口），再投影回主题任务行。
// 跨队列依赖（"topicKey:id"）只落在任务行 blockBy，不进本 topic 引擎节点图。
import '../tasktool/plugins/index.js';
import { createTopicEngine } from './engine.js';
import { normalizeBlockBy, parseDepRef } from '../../core/workflow/readiness.js';
import { isGateNode } from '../../core/workflow/types.js';
import type { DagMutator } from './mutator/index.js';
import type { SnapshotStoreLike } from './mutator/index.js';

/** withTopicMutator 交给回调的引擎 API 面。 */
export interface TopicMutatorApi {
  mutator: DagMutator;
  store: SnapshotStoreLike;
  scheduler: { runOnce(workflowId: string): Promise<unknown> };
}

/** @param {Array<number|string>} deps */
function localDepIds(deps?: Array<number | string>): number[] {
  const out: number[] = [];
  for (const d of deps || []) {
    const ref = parseDepRef(d);
    if (ref?.kind === 'local') out.push(ref.id);
  }
  return out;
}

/**
 * @param {string} topicKey
 * @param {(api: { mutator: object, store: object, scheduler: object }) => Promise<unknown>} fn
 */
export async function withTopicMutator<T>(topicKey: string, fn: (api: TopicMutatorApi) => Promise<T>): Promise<T> {
  const engine = await createTopicEngine({ debounceMs: 0 });
  try {
    try {
      await engine.store.load(topicKey);
    } catch (err) {
      if ((err as { code?: string })?.code !== 'NOT_FOUND') throw err;
      await engine.store.create({ key: topicKey });
    }
    return await fn({
      mutator: engine.mutator,
      store: engine.store,
      scheduler: engine.scheduler,
    });
  } finally {
    await engine.close();
  }
}

async function ensureNode(mutator: DagMutator, store: SnapshotStoreLike, topicKey: string, id: string | number, kind: 'task' | 'control' = 'task'): Promise<void> {
  const snap = await store.load(topicKey);
  if ((snap.nodes || []).some((n) => String(n.id) === String(id))) return;
  await mutator.addNode(topicKey, { id, kind, state: 'pending' });
}

/** syncNewTaskDag 的任务入参（JSON 形态任务的最小子集）。 */
export interface NewTaskDagInput {
  id: number | string;
  blockBy?: Array<number | string>;
  blocksFollowing?: boolean;
}

/**
 * 新任务入队后同步 DAG 到引擎。
 * @param {string} topicKey
 * @param {{ id: number|string, blockBy?: number[], blocksFollowing?: boolean }} task
 */
export async function syncNewTaskDag(topicKey: string, task: NewTaskDagInput): Promise<void> {
  if (!task?.id) return;
  const deps = normalizeBlockBy(task.blockBy, task.id);
  const gate = !!task.blocksFollowing;
  if (!deps.length && !gate) return;

  await withTopicMutator(topicKey, async ({ mutator, store, scheduler }) => {
    await ensureNode(mutator, store, topicKey, task.id, gate ? 'control' : 'task');
    if (gate) {
      await mutator.bindPlugin(
        topicKey,
        { nodeId: task.id },
        { name: 'blockgoal', scope: 'control' },
      );
    }
    for (const from of localDepIds(deps)) {
      await ensureNode(mutator, store, topicKey, from, 'task');
      await mutator.addEdge(topicKey, from, task.id);
    }
    await scheduler.runOnce(topicKey);
  });
}

/** syncTaskDagUpdate 的 patch 形状。 */
export interface TaskDagUpdateInput {
  blockBy?: Array<number | string>;
  clearBlockBy?: boolean;
  blocksFollowing?: boolean;
}

/** 更新已有任务的 DAG 字段 */
export async function syncTaskDagUpdate(
  topicKey: string,
  taskId: string | number,
  { blockBy, clearBlockBy, blocksFollowing }: TaskDagUpdateInput = {},
): Promise<void> {
  await withTopicMutator(topicKey, async ({ mutator, store, scheduler }) => {
    await ensureNode(
      mutator,
      store,
      topicKey,
      taskId,
      blocksFollowing ? 'control' : 'task',
    );

    if (blocksFollowing === true) {
      await mutator.bindPlugin(
        topicKey,
        { nodeId: taskId },
        { name: 'blockgoal', scope: 'control' },
      );
    } else if (blocksFollowing === false) {
      try {
        await mutator.unbindPlugin(topicKey, { nodeId: taskId }, 'blockgoal');
      } catch {
        /* 未绑定则忽略 */
      }
    }

    if (clearBlockBy || blockBy !== undefined) {
      const fresh = await store.load(topicKey);
      const incoming = (fresh.edges || []).filter((e) => String(e.to) === String(taskId));
      for (const e of incoming) {
        const fromNode = (fresh.nodes || []).find((n) => String(n.id) === String(e.from));
        // 闸门的隐含边（gate→后续）由 blocksFollowing 表达——拆边时保留
        if (!isGateNode(fromNode)) await mutator.removeEdge(topicKey, e.from, taskId);
      }
      if (!clearBlockBy && blockBy !== undefined) {
        for (const from of localDepIds(normalizeBlockBy(blockBy, taskId))) {
          await ensureNode(mutator, store, topicKey, from, 'task');
          await mutator.addEdge(topicKey, from, taskId);
        }
      }
    }
    await scheduler.runOnce(topicKey);
  });
}

/** 完成任务 → 节点 success */
export async function markTaskSuccess(topicKey: string, taskId: string | number): Promise<void> {
  await withTopicMutator(topicKey, async ({ mutator, store, scheduler }) => {
    await ensureNode(mutator, store, topicKey, taskId, 'task');
    await mutator.setNodeState(topicKey, taskId, 'success');
    await scheduler.runOnce(topicKey);
  });
}
