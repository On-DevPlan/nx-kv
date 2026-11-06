// SnapshotStore：create / load / saveAtomic（CAS via revision）
import crypto from 'node:crypto';
import { createMemoryAdapter } from './memory-adapter.js';
import { createFileAdapter } from './file-adapter.js';

/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */
/** @typedef {import('../../../core/workflow/types.js').InitMeta} InitMeta */

function stamp() {
  return new Date().toISOString();
}

function emptySnapshot(workflowId) {
  /** @type {WorkflowSnapshot} */
  return {
    workflowId,
    state: 'active',
    nodes: [],
    edges: [],
    workflowPlugins: [],
    revision: 0,
    updatedAt: stamp(),
  };
}

/**
 * @param {{ adapter?: { get: Function, set: Function } }} [opts]
 */
export function createSnapshotStore(opts = {}) {
  const adapter = opts.adapter || createMemoryAdapter();

  return {
    adapter,

    /** @param {InitMeta} [initMeta] */
    async create(initMeta = {}) {
      const workflowId =
        (initMeta.key && String(initMeta.key).trim()) ||
        crypto.randomBytes(8).toString('hex');
      const snap = emptySnapshot(workflowId);
      if (initMeta.meta && typeof initMeta.meta === 'object') {
        snap.meta = { ...initMeta.meta };
      }
      if (initMeta.cwd) snap.meta = { ...(snap.meta || {}), cwd: initMeta.cwd };
      await adapter.set(snap);
      return workflowId;
    },

    /** @param {string} workflowId */
    async load(workflowId) {
      const snap = await adapter.get(workflowId);
      if (!snap) {
        const err = new Error(`workflow not found: ${workflowId}`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      return snap;
    },

    /**
     * 原子覆盖。若传入 expectedRevision 且不等 → 抛 CAS 冲突。
     * @param {WorkflowSnapshot} snapshot
     * @param {{ expectedRevision?: number }} [cas]
     */
    async saveAtomic(snapshot, cas = {}) {
      if (!snapshot?.workflowId) throw new Error('snapshot.workflowId required');
      const prev = await adapter.get(snapshot.workflowId);
      if (cas.expectedRevision != null && prev && prev.revision !== cas.expectedRevision) {
        const err = new Error(
          `CAS conflict: expected revision ${cas.expectedRevision}, got ${prev.revision}`,
        );
        err.code = 'CAS_CONFLICT';
        throw err;
      }
      const next = {
        ...snapshot,
        revision: (prev?.revision ?? snapshot.revision ?? 0) + 1,
        updatedAt: stamp(),
      };
      await adapter.set(next);
      return next;
    },
  };
}

export { createMemoryAdapter, createFileAdapter };

/**
 * 现网主题队列绑定的 SnapshotStore（SQLite topics/tasks ↔ 快照）。
 *
 * T03：适配器换成 DB 版（repo/snapshot.js），CAS 从「先读后写」变成**事务内比较**，
 * SnapshotStore / DagMutator 的接口面不变。
 */
export async function createTopicSnapshotStore() {
  const { createDbTopicAdapter } = await import('../repo/snapshot.js');
  const { openLocaltaskStore } = await import('../repo/index.js');
  openLocaltaskStore(); // 确保连接就绪（建表 / 迁移在此发生）
  return createSnapshotStore({ adapter: createDbTopicAdapter() });
}
