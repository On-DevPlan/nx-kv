/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */

import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

/** 快照存储适配器接口：get/set/has/delete 四件套 + clear（file/memory 三实现可互换）。 */
export interface SnapshotAdapter {
  get(id: string): Promise<WorkflowSnapshot | null>;
  set(snapshot: WorkflowSnapshot): Promise<void>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  clear(): void;
}

export function createMemoryAdapter(): SnapshotAdapter {
  /** @type {Map<string, WorkflowSnapshot>} */
  const map = new Map<string, WorkflowSnapshot>();

  return {
    async get(id: string): Promise<WorkflowSnapshot | null> {
      const s = map.get(id);
      if (!s) return null;
      return structuredClone(s);
    },
    async set(snapshot: WorkflowSnapshot): Promise<void> {
      map.set(snapshot.workflowId, structuredClone(snapshot));
    },
    async has(id: string): Promise<boolean> {
      return map.has(id);
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    clear(): void {
      map.clear();
    },
  };
}
