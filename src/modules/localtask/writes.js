// 日常 DAG 写路径 —— 一律经 Mutator（单一写入口），再投影回主题任务行。
import '../tasktool/plugins/index.js';
import { createTopicEngine } from './engine.js';
import { normalizeBlockBy } from '../../core/workflow/readiness.js';

/**
 * @param {string} topicKey
 * @param {(api: { mutator: object, store: object, scheduler: object }) => Promise<unknown>} fn
 */
export async function withTopicMutator(topicKey, fn) {
  const engine = await createTopicEngine({ debounceMs: 0 });
  try {
    try {
      await engine.store.load(topicKey);
    } catch (err) {
      if (err?.code !== 'NOT_FOUND') throw err;
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

async function ensureNode(mutator, store, topicKey, id, kind = 'task') {
  const snap = await store.load(topicKey);
  if ((snap.nodes || []).some((n) => String(n.id) === String(id))) return;
  await mutator.addNode(topicKey, { id, kind, state: 'pending' });
}

/**
 * 新任务入队后同步 DAG 到引擎。
 * @param {string} topicKey
 * @param {{ id: number|string, blockBy?: number[], blocksFollowing?: boolean }} task
 */
export async function syncNewTaskDag(topicKey, task) {
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
    for (const from of deps) {
      await ensureNode(mutator, store, topicKey, from, 'task');
      await mutator.addEdge(topicKey, from, task.id);
    }
    await scheduler.runOnce(topicKey);
  });
}

/** 更新已有任务的 DAG 字段 */
export async function syncTaskDagUpdate(
  topicKey,
  taskId,
  { blockBy, clearBlockBy, blocksFollowing } = {},
) {
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
        const isGate =
          fromNode?.kind === 'control' ||
          (fromNode?.plugins || []).some((p) => p.name === 'blockgoal');
        if (!isGate) await mutator.removeEdge(topicKey, e.from, taskId);
      }
      if (!clearBlockBy && blockBy !== undefined) {
        for (const from of normalizeBlockBy(blockBy, taskId)) {
          await ensureNode(mutator, store, topicKey, from, 'task');
          await mutator.addEdge(topicKey, from, taskId);
        }
      }
    }
    await scheduler.runOnce(topicKey);
  });
}

/** 完成任务 → 节点 success */
export async function markTaskSuccess(topicKey, taskId) {
  await withTopicMutator(topicKey, async ({ mutator, store, scheduler }) => {
    await ensureNode(mutator, store, topicKey, taskId, 'task');
    await mutator.setNodeState(topicKey, taskId, 'success');
    await scheduler.runOnce(topicKey);
  });
}
