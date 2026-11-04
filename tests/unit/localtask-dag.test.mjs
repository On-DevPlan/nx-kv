import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBlockBy,
  parseDepRef,
  isReadyToClaim,
  findFirstReadyPending,
} from '../../src/modules/localtask/dag.js';
import { applySnapshotToTopic, topicToSnapshot } from '../../src/core/workflow/project.js';

const T = (id, patch = {}) => ({
  id,
  status: 'pending',
  text: `#${id}`,
  deletedAt: '',
  migratedTo: null,
  completedAt: '',
  ...patch,
});

test('normalizeBlockBy：去重、去非法、去自身', () => {
  assert.deepEqual(normalizeBlockBy([2, 2, '3', 0, -1, 'x', 5], 5), [2, 3]);
});

test('normalizeBlockBy：跨队列 key:id 与本地 id 可混写', () => {
  assert.deepEqual(normalizeBlockBy([1, 'abc12:3', 'abc12:3', '1'], 9), [1, 'abc12:3']);
  assert.equal(parseDepRef('abc12:3')?.kind, 'foreign');
  assert.equal(parseDepRef(3)?.kind, 'local');
});

test('无依赖：按数组序 FIFO', () => {
  const tasks = [T(1), T(2), T(3)];
  assert.equal(findFirstReadyPending(tasks).id, 1);
});

test('blockBy：依赖未完成 → 跳过；完成后可领', () => {
  const tasks = [
    T(1, { status: 'consumed', completedAt: '' }), // 领了但没 done
    T(2, { blockBy: [1] }),
    T(3),
  ];
  // #1 不是 pending；#2 被 #1 挡住；#3 无依赖 → 领 #3
  assert.equal(findFirstReadyPending(tasks).id, 3);

  tasks[0].completedAt = '2026-11-04 12:00:00';
  assert.equal(findFirstReadyPending(tasks).id, 2);
});

test('blocksFollowing 闸门：挡住后面所有 pending，直到自身 completedAt', () => {
  const tasks = [
    T(1),
    T(2, { blocksFollowing: true }),
    T(3),
    T(4),
  ];
  // #1 在闸门前，可领
  assert.equal(findFirstReadyPending(tasks).id, 1);

  tasks[0].status = 'consumed';
  tasks[0].completedAt = '2026-11-04 10:00:00';
  // #2 闸门自身可领
  assert.equal(findFirstReadyPending(tasks).id, 2);
  assert.equal(isReadyToClaim(tasks[2], tasks), false);
  assert.equal(isReadyToClaim(tasks[3], tasks), false);

  tasks[1].status = 'consumed';
  tasks[1].completedAt = '2026-11-04 11:00:00';
  assert.equal(findFirstReadyPending(tasks).id, 3);
});

test('删除 / 迁出的依赖不算有效依赖（挡不住）', () => {
  const tasks = [
    T(1, { deletedAt: '2026-11-04 09:00:00' }),
    T(2, { blockBy: [1] }),
  ];
  assert.equal(findFirstReadyPending(tasks).id, 2);
});

test('跨队列 blockBy：前驱未完成挡住；完成后放行；缺失 fail-open', () => {
  const foreign = { key: 'otherkey', id: 7 };
  const foreignTask = T(7, { status: 'consumed', completedAt: '' });
  const resolveForeign = (key, id) =>
    key === foreign.key && id === foreign.id ? foreignTask : null;

  const tasks = [T(2, { blockBy: [`${foreign.key}:${foreign.id}`] }), T(3)];
  assert.equal(isReadyToClaim(tasks[0], tasks, { resolveForeign }), false);
  assert.equal(findFirstReadyPending(tasks, { resolveForeign }).id, 3);

  foreignTask.completedAt = '2026-11-04 12:00:00';
  assert.equal(isReadyToClaim(tasks[0], tasks, { resolveForeign }), true);
  assert.equal(findFirstReadyPending(tasks, { resolveForeign }).id, 2);

  // 解析不到 → fail-open
  assert.equal(
    isReadyToClaim(T(9, { blockBy: ['missing:1'] }), [T(9, { blockBy: ['missing:1'] })], {
      resolveForeign: () => null,
    }),
    true,
  );
});

test('投影回写保留跨队列 blockBy，不把 foreign 边抹掉', () => {
  const topic = {
    key: 't1',
    cwd: '/x',
    name: 'x',
    tasks: [T(1), T(2, { blockBy: [1, 'other:9'] })],
    workflowRevision: 0,
  };
  const snap = topicToSnapshot(topic);
  // 引擎边不应含 foreign
  assert.ok(!snap.edges.some((e) => String(e.from).includes(':')));
  applySnapshotToTopic(topic, { ...snap, revision: 1 });
  const t2 = topic.tasks.find((t) => t.id === 2);
  assert.deepEqual(normalizeBlockBy(t2.blockBy, 2), [1, 'other:9']);
});
