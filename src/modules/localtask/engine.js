// 主题队列上的引擎装配：SnapshotStore(topic) + bus + mutator + scheduler
import '../tasktool/plugins/index.js'; // IoC：加载即注册全部 goal
import { createEventBus } from './bus/index.js';
import { createDagMutator } from './mutator/index.js';
import { createScheduler } from './scheduler/index.js';
import { createTopicSnapshotStore } from './store/index.js';

/**
 * @param {{ debounceMs?: number }} [opts]
 */
export async function createTopicEngine(opts = {}) {
  const store = await createTopicSnapshotStore();
  const bus = createEventBus();
  const mutator = createDagMutator({ store, bus });
  const scheduler = createScheduler({
    store,
    bus,
    debounceMs: opts.debounceMs ?? 10,
  });
  scheduler.start();
  return {
    store,
    bus,
    mutator,
    scheduler,
    async close() {
      scheduler.stop();
      bus.clear();
    },
  };
}

/**
 * 完成任务后：把主题投影进引擎跑一轮就绪（fail-open）。
 * 现网领取仍靠 isReadyToClaim；此步同步 workflowRevision / 闸门投影。
 */
export async function refreshTopicAfterComplete(topicKey) {
  try {
    const { store, scheduler, close } = await createTopicEngine({ debounceMs: 0 });
    try {
      await store.load(topicKey);
      await scheduler.runOnce(topicKey);
    } finally {
      await close();
    }
  } catch {
    /* 主题不存在或引擎故障不挡 complete */
  }
}
