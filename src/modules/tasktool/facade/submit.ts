// Facade submit(initMeta) → workflowId
// 语义：只确保主题/工作流存在；有 text 则入队（不在此构造全图）。
import { submitTask } from '../add.js';
import { createTopicSnapshotStore } from '../../localtask/store/index.js';

/** submit 的入参（core/workflow InitMeta 的宽松形态 + 任意附加键） */
export interface FacadeSubmitMeta {
  cwd?: string;
  key?: string;
  text?: unknown;
  blockBy?: unknown;
  blocksFollowing?: boolean;
  gate?: boolean;
  meta?: Record<string, unknown>;
  [k: string]: any;
}

/**
 * @returns Promise<{ workflowId: string, key: string, cwd?: string, name?: string, task?: object, status: string }>
 */
export async function submit(initMeta: FacadeSubmitMeta = {}): Promise<Record<string, any>> {
  const { normalizeCwd } = await import('../../localtask/service.js');
  // paths.normalizeCwd 的 @returns 标注漏了 name（运行时恒返回 {cwd, name, key}）
  const { key, cwd, name } = normalizeCwd(initMeta.cwd || initMeta.key) as { cwd: string; key: string; name: string };

  // SnapshotStore：确保 workflow 桶存在（topic adapter 会建主题壳）
  const store = await createTopicSnapshotStore();
  try {
    await store.load(key);
  } catch (err) {
    if ((err as any)?.code === 'NOT_FOUND') {
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
