import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/modules/goals/plugins/index.js'; // IoC 自注册
import { createSnapshotStore, createMemoryAdapter } from '../../src/modules/localtask/infra/store/index.js';
import { createEventBus, EVENTS } from '../../src/modules/localtask/infra/bus/index.js';
import { createDagMutator } from '../../src/modules/localtask/infra/mutator/index.js';
import { createScheduler } from '../../src/modules/localtask/infra/scheduler/index.js';
import { listPluginIds, getPlugin } from '../../src/modules/goals/plugins/container.js';
import { BasePlugin } from '../../src/modules/goals/plugins/base.js';
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

test('IoC：三个目标插件自注册且均为 BasePlugin', () => {
  for (const id of ['blockgoal', 'timegoal', 'taskgoal']) {
    assert.ok(listPluginIds().includes(id), id);
    assert.ok(getPlugin(id) instanceof BasePlugin, id);
  }
  assert.deepEqual(PLUGIN_HOOKS, ['onBind', 'onSchedule', 'onGet', 'onUnbind']);
  assert.ok(HOOK_CHAINS.schedule.includes('onSchedule'));
  assert.ok(HOOK_CHAINS.get.includes('onGet'));
});
