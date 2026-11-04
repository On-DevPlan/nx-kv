/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */

export function createMemoryAdapter() {
  /** @type {Map<string, WorkflowSnapshot>} */
  const map = new Map();

  return {
    async get(id) {
      const s = map.get(id);
      if (!s) return null;
      return structuredClone(s);
    },
    async set(snapshot) {
      map.set(snapshot.workflowId, structuredClone(snapshot));
    },
    async has(id) {
      return map.has(id);
    },
    async delete(id) {
      map.delete(id);
    },
    clear() {
      map.clear();
    },
  };
}
