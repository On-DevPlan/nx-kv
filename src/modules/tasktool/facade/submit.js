// Facade submit(initMeta) → workflowId
// 语义：只确保主题/工作流存在；有 text 则入队（不在此构造全图）。
import { submitTask } from '../add.js';
import { createTopicSnapshotStore } from '../../localtask/store/index.js';

/**
 * @param {import('../../../core/workflow/types.js').InitMeta & Record<string, unknown>} initMeta
 * @returns {Promise<{ workflowId: string, key: string, cwd?: string, name?: string, task?: object, status: string }>}
 */
export async function submit(initMeta = {}) {
  const { normalizeCwd } = await import('../../localtask/service.js');
  const { key, cwd, name } = normalizeCwd(initMeta.cwd || initMeta.key);

  // SnapshotStore：确保 workflow 桶存在（topic adapter 会建主题壳）
  const store = await createTopicSnapshotStore();
  try {
    await store.load(key);
  } catch (err) {
    if (err?.code === 'NOT_FOUND') {
      await store.create({ key, cwd, meta: { name, ...(initMeta.meta || {}) } });
    } else {
      throw err;
    }
  }

  if (initMeta.text != null && String(initMeta.text).trim()) {
    const added = await submitTask({
      cwd,
      text: initMeta.text,
      blockBy: initMeta.blockBy,
      blocksFollowing: initMeta.blocksFollowing ?? initMeta.gate,
      ...(initMeta.meta || {}),
    });
    return {
      status: 'ok',
      workflowId: key,
      key,
      cwd: added.cwd ?? cwd,
      name: added.name ?? name,
      task: added.task,
      delivered: added.delivered,
      queued: added.queued,
    };
  }

  return { status: 'ok', workflowId: key, key, cwd, name, created: true };
}

export { submitTask };
