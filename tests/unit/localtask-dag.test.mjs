import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBlockBy,
  isReadyToClaim,
  findFirstReadyPending,
} from '../../src/modules/localtask/dag.js';

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
