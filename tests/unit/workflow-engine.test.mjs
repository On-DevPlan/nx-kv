import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/modules/tasktool/plugins/index.js'; // IoC 自注册
import { createSnapshotStore, createMemoryAdapter } from '../../src/modules/localtask/store/index.js';
import { createEventBus, EVENTS } from '../../src/modules/localtask/bus/index.js';
import { createDagMutator } from '../../src/modules/localtask/mutator/index.js';
import { createScheduler } from '../../src/modules/localtask/scheduler/index.js';
import { runGetHooks } from '../../src/modules/tasktool/plugins/runtime.js';
import { listPluginIds, getPlugin } from '../../src/modules/tasktool/plugins/container.js';
import { BasePlugin } from '../../src/modules/tasktool/plugins/base.js';
import { HOOK_CHAINS, PLUGIN_HOOKS } from '../../src/core/workflow/lifecycle.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('SnapshotStore：create / load / saveAtomic CAS', async () => {
  const store = createSnapshotStore({ adapter: createMemoryAdapter() });
  const id = await store.create({ cwd: '/tmp/x' });
  const snap = await store.load(id);
  assert.equal(snap.revision, 0);
  const saved = await store.saveAtomic({ ...snap, nodes: [] });
  assert.equal(saved.revision, 1);
  await assert.rejects(
    () => store.saveAtomic({ ...saved, nodes: [] }, { expectedRevision: 0 }),
    (e) => e.code === 'CAS_CONFLICT',
  );
});

test('Mutator + Scheduler：blockgoal 挡住后继，success 后放行', async () => {
  const store = createSnapshotStore({ adapter: createMemoryAdapter() });
  const bus = createEventBus();
  const mutator = createDagMutator({ store, bus });
  const scheduler = createScheduler({ store, bus, debounceMs: 5 });
  scheduler.start();

  const id = await store.create({});
  await mutator.addNode(id, { id: 'gate', kind: 'control', state: 'pending' });
  await mutator.bindPlugin(id, { nodeId: 'gate' }, { name: 'blockgoal', scope: 'control' });
  await mutator.addNode(id, { id: 'work', kind: 'task', state: 'pending' });
  await mutator.addEdge(id, 'gate', 'work');

  await sleep(30);
  let snap = await store.load(id);
  const work = snap.nodes.find((n) => n.id === 'work');
  assert.equal(work.state, 'pending'); // 闸门未完成

  await mutator.setNodeState(id, 'gate', 'success');
  await sleep(30);
  snap = await store.load(id);
  assert.equal(snap.nodes.find((n) => n.id === 'work').state, 'ready');

  scheduler.stop();
});

test('Mutator：删除 blockgoal 边后后继可就绪', async () => {
  const store = createSnapshotStore({ adapter: createMemoryAdapter() });
  const bus = createEventBus();
  const mutator = createDagMutator({ store, bus });
  const scheduler = createScheduler({ store, bus, debounceMs: 5 });
  scheduler.start();

  const id = await store.create({});
  await mutator.addNode(id, { id: 'g', kind: 'control' });
  await mutator.bindPlugin(id, { nodeId: 'g' }, { name: 'blockgoal', scope: 'control' });
  await mutator.addNode(id, { id: 'a', kind: 'task' });
  await mutator.addEdge(id, 'g', 'a');
  await sleep(20);
  assert.equal((await store.load(id)).nodes.find((n) => n.id === 'a').state, 'pending');

  await mutator.removeEdge(id, 'g', 'a');
  await sleep(20);
  assert.equal((await store.load(id)).nodes.find((n) => n.id === 'a').state, 'ready');
  scheduler.stop();
});

test('EventBus：dag:mutated 会触发', async () => {
  const store = createSnapshotStore({ adapter: createMemoryAdapter() });
  const bus = createEventBus();
  const mutator = createDagMutator({ store, bus });
  let hit = 0;
  bus.on(EVENTS.DAG_MUTATED, () => {
    hit += 1;
  });
  const id = await store.create({});
  await mutator.addNode(id, { id: 1, kind: 'task' });
  assert.ok(hit >= 1);
});

test('IoC：四插件自注册且均为 BasePlugin', () => {
  for (const id of ['blockgoal', 'waitgoal', 'timegoal', 'taskgoal']) {
    assert.ok(listPluginIds().includes(id), id);
    assert.ok(getPlugin(id) instanceof BasePlugin, id);
  }
  assert.deepEqual(PLUGIN_HOOKS, ['onBind', 'onSchedule', 'onGet', 'onUnbind']);
  assert.ok(HOOK_CHAINS.schedule.includes('onSchedule'));
  assert.ok(HOOK_CHAINS.get.includes('onGet'));
});

test('runGetHooks：waitgoal 拉到一条即结束', async () => {
  const snap = {
    workflowId: 'w',
    state: 'active',
    revision: 1,
    nodes: [
      {
        id: 'n1',
        kind: 'task',
        state: 'ready',
        plugins: [{ name: 'waitgoal', scope: 'node', config: { waitMinutes: 0.05 } }],
      },
    ],
    edges: [],
    workflowPlugins: [],
  };
  let pulls = 0;
  const items = [];
  for await (const x of runGetHooks(
    { snapshot: snap, nodeId: 'n1' },
    {
      pull: async () => {
        pulls += 1;
        return pulls >= 2 ? { id: 9 } : null;
      },
    },
  )) {
    items.push(x);
  }
  assert.deepEqual(items, [{ id: 9 }]);
});
