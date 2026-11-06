import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/modules/tasktool/plugins/index.js';
import { applySnapshotToTopic, topicToSnapshot } from '../../src/core/workflow/project.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('adapter set：bind blockgoal → blocksFollowing（DB 版 topic-adapter）', async () => {
  const sb = mkdtempSync(join(tmpdir(), 'nxkv-wfproj-'));
  const prev = process.env.NX_KV_LOCALTASK_STORE;
  process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
  try {
    const repo = (await import('../../src/modules/localtask/repo/index.js')).default;
    repo.open();
    const t = repo.topics.ensureTopic('t1', { cwd: join(sb, 't1'), name: 't1' });
    repo.tasks.insertTask(t.id, { id: 10, text: 'a', status: 'pending' });
    repo.tasks.insertTask(t.id, { id: 11, text: 'b', status: 'pending' });

    const adapter = createTopicAdapter();
    const store = createSnapshotStore({ adapter });
    const mutator = createDagMutator({ store, bus: createEventBus() });

    await mutator.bindPlugin('t1', { nodeId: 10 }, { name: 'blockgoal', scope: 'control' });
    await mutator.addEdge('t1', 10, 11);

    const topic = repo.topics.getTopic('t1');
    assert.equal(topic.tasks.find((x) => x.id === 10).blocksFollowing, true);
    assert.deepEqual(topic.tasks.find((x) => x.id === 11).blockBy, []);
    assert.ok(topic.workflowRevision >= 1);
  } finally {
    if (prev === undefined) delete process.env.NX_KV_LOCALTASK_STORE;
    else process.env.NX_KV_LOCALTASK_STORE = prev;
    const { closeDb } = await import('../../src/modules/localtask/repo/index.js');
    closeDb();
    rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
  }
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

// 现场回归（CI：localtask-attribution「历史脏数据但带本地依赖」偶发搬家）：
// 外部把 blockBy 写进任务行之后，引擎**在途**的过期快照（还没有这条边）落盘，
// 投影必须保留外部依赖（并集），而不是按过期边把它洗成 [] ——否则「队列内依赖不搬」
// 的守卫读不到依赖，搬家被错误放行。
test('applySnapshotToTopic：过期快照不洗外部新设的本地依赖（并集）', () => {
  const topic = {
    key: 'k',
    tasks: [
      { id: 1, status: 'pending', text: 'a', blockBy: [], blocksFollowing: false },
      { id: 2, status: 'pending', text: 'b', blockBy: [], blocksFollowing: false },
    ],
  };
  // T0 拍快照：此刻 #2 还没有依赖 → 边里没有 1→2
  const staleSnap = topicToSnapshot(topic);
  assert.equal(staleSnap.edges.length, 0);
  // T1 外部写（不走引擎）：#2 设 blockBy=[1]
  topic.tasks.find((t) => t.id === 2).blockBy = [1];
  // 在途过期快照落盘（topic-adapter.set 的投影动作）
  applySnapshotToTopic(topic, staleSnap);
  assert.deepEqual(
    topic.tasks.find((t) => t.id === 2).blockBy,
    [1],
    '外部依赖必须存活，不能被过期边洗掉',
  );
});

test('applySnapshotToTopic：跨队列引用同样存活（keepForeign 不回退）', () => {
  const topic = {
    key: 'k',
    tasks: [
      { id: 1, status: 'pending', text: 'a', blockBy: ['other:9'], blocksFollowing: false },
    ],
  };
  const staleSnap = topicToSnapshot(topic);
  applySnapshotToTopic(topic, staleSnap);
  assert.deepEqual(topic.tasks[0].blockBy, ['other:9']);
});

// 外部写顶 revision 之后，引擎在途快照（旧 revision）落盘必须 CAS 冲突——
// 这是「过期写洗任务行」的第一道闸（投影并集是第二道）。
test('topic-adapter：外部写 bump revision → 过期快照 saveAtomic CAS 冲突', async () => {
  const sb = mkdtempSync(join(tmpdir(), 'nxkv-wfproj2-'));
  const prev = process.env.NX_KV_LOCALTASK_STORE;
  process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
  try {
    const repo = (await import('../../src/modules/localtask/repo/index.js')).default;
    repo.open();
    const t = repo.topics.ensureTopic('t1', { cwd: join(sb, 't1'), name: 't1' });
    repo.tasks.insertTask(t.id, { id: 1, text: 'a', status: 'pending' });

    const adapter = createTopicAdapter();
    const store = createSnapshotStore({ adapter });

    // 引擎在 T0 拍下快照（version 0）；随后外部写把 revision 顶到 1
    const staleSnap = await store.load('t1');
    assert.equal(staleSnap.revision, 0);
    repo.topics.updateTopic('t1', { bumpRevision: true });

    await assert.rejects(
      () => store.saveAtomic(staleSnap, { expectedRevision: staleSnap.revision }),
      (err) => err.code === 'CAS_CONFLICT',
      '过期快照落盘必须被 CAS 拦下',
    );
    // 数据没被洗：任务行原样
    assert.equal(repo.tasks.getTaskRow(t.id, 1).task.text, 'a');
  } finally {
    if (prev === undefined) delete process.env.NX_KV_LOCALTASK_STORE;
    else process.env.NX_KV_LOCALTASK_STORE = prev;
    const { closeDb } = await import('../../src/modules/localtask/repo/index.js');
    closeDb();
    rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
  }
});
