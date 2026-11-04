// Facade get(workflowId, nodeId?) → AsyncIterable
// 真实现：PluginRuntime.runGetHooks + pull=consumeFirstPending；
// getTask 仍给 CLI/agent 单次领取（内部可走 wait）。
import '../plugins/index.js';
import { runGetHooks } from '../plugins/runtime.js';
import { createTopicSnapshotStore } from '../../localtask/store/index.js';
import { getTask as getTaskImpl } from '../get.js';

/**
 * 引擎态异步迭代领取。
 * @param {string} workflowId 主题 key
 * @param {string|number} [nodeId]
 * @param {{ signal?: AbortSignal, summary?: string, pull?: () => Promise<unknown|null> }} [opts]
 */
export async function* get(workflowId, nodeId, opts = {}) {
  const store = await createTopicSnapshotStore();
  let snap;
  try {
    snap = await store.load(workflowId);
  } catch (err) {
    if (err?.code === 'NOT_FOUND') return;
    throw err;
  }

  const pull =
    opts.pull ||
    (async () => {
      const { consumeFirstPending } = await import('../../localtask/service.js');
      return consumeFirstPending(workflowId, opts.summary || '', {
        key: workflowId,
        name: snap.meta?.name || workflowId,
      });
    });

  yield* runGetHooks(
    { snapshot: snap, nodeId, signal: opts.signal },
    { pull },
  );
}

/** CLI/agent 兼容：单次领取（原 getTask） */
export async function getTask(args) {
  return getTaskImpl(args);
}

export { getTaskImpl };
