import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/modules/tasktool/plugins/index.js';
import { applySnapshotToTopic, topicToSnapshot } from '../../src/core/workflow/project.js';
import { createTopicAdapter } from '../../src/modules/localtask/store/topic-adapter.js';
import { createSnapshotStore } from '../../src/modules/localtask/store/index.js';
import { createDagMutator } from '../../src/modules/localtask/mutator/index.js';
import { createEventBus } from '../../src/modules/localtask/bus/index.js';

test('topicToSnapshot：闸门任务 → control + blockgoal + 边', () => {
  const topic = {
    key: 'abc',
    cwd: '/x',
    name: 'x',
    tasks: [
      { id: 1, status: 'pending', blocksFollowing: true, text: 'gate' },
      { id: 2, status: 'pending', blockBy: [1], text: 'work' },
    ],
  };
  const snap = topicToSnapshot(topic);
  assert.equal(snap.workflowId, 'abc');
  assert.equal(snap.nodes.find((n) => n.id === 1).kind, 'control');
  assert.ok(snap.edges.some((e) => e.from === 1 && e.to === 2));
});

test('applySnapshotToTopic：bind blockgoal → blocksFollowing', async () => {
  const bag = {
    topics: {
      t1: {
        key: 't1',
        name: 't1',
        tasks: [
          { id: 10, status: 'pending', text: 'a', blockBy: [], blocksFollowing: false },
          { id: 11, status: 'pending', text: 'b', blockBy: [], blocksFollowing: false },
        ],
        workflowRevision: 0,
      },
    },
  };
  const adapter = createTopicAdapter({
    loadStore: async () => bag,
    saveStore: async (data) => {
      Object.assign(bag, data);
    },
  });
  const store = createSnapshotStore({ adapter });
  const mutator = createDagMutator({ store, bus: createEventBus() });

  await mutator.bindPlugin('t1', { nodeId: 10 }, { name: 'blockgoal', scope: 'control' });
  await mutator.addEdge('t1', 10, 11);

  const topic = bag.topics.t1;
  assert.equal(topic.tasks.find((t) => t.id === 10).blocksFollowing, true);
  // 闸门边不写进 blockBy（由 blocksFollowing 表达）
  assert.deepEqual(topic.tasks.find((t) => t.id === 11).blockBy, []);
  assert.ok(topic.workflowRevision >= 1);
});

test('往返：显式 blockBy 保留', () => {
  const topic = {
    key: 'k',
    tasks: [
      { id: 1, status: 'pending', text: 'a', blockBy: [], blocksFollowing: false },
      { id: 2, status: 'pending', text: 'b', blockBy: [1], blocksFollowing: false },
    ],
  };
  const snap = topicToSnapshot(topic);
  applySnapshotToTopic(topic, { ...snap, revision: 3 });
  assert.deepEqual(topic.tasks.find((t) => t.id === 2).blockBy, [1]);
  assert.equal(topic.workflowRevision, 3);
});
