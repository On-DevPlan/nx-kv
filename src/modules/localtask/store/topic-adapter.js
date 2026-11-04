// 把 SnapshotStore 接到现网 localtasks.json 主题桶。
import { applySnapshotToTopic, topicToSnapshot } from '../../../core/workflow/project.js';

/**
 * @param {{ loadStore: () => Promise<object>, saveStore: (data: object) => Promise<void>, ensureTopic?: Function }} deps
 */
export function createTopicAdapter({ loadStore, saveStore }) {
  return {
    async get(workflowId) {
      const store = await loadStore();
      const topic = store.topics?.[workflowId];
      if (!topic) return null;
      return topicToSnapshot(topic);
    },

    async set(snapshot) {
      const store = await loadStore();
      if (!store.topics) store.topics = {};
      let topic = store.topics[snapshot.workflowId];
      if (!topic) {
        topic = {
          key: snapshot.workflowId,
          cwd: snapshot.meta?.cwd || '',
          name: snapshot.meta?.name || snapshot.workflowId,
          createdAt: snapshot.updatedAt || new Date().toISOString(),
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
          waiting: false,
          waitingUntil: '',
          summary: '',
          tasks: [],
        };
        store.topics[snapshot.workflowId] = topic;
      }
      applySnapshotToTopic(topic, snapshot);
      await saveStore(store);
    },

    async has(workflowId) {
      const store = await loadStore();
      return !!store.topics?.[workflowId];
    },
  };
}
