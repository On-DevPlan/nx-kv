import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDirectoryRows } from '../../src/modules/localtask/board.js';

test('mergeDirectoryRows：同一个目录的 localtask 与 timegoal 合并成一行', () => {
  const topics = [
    { key: 'a', name: 'alpha', cwd: 'D:/alpha', waiting: true, pending: 2, total: 3 },
  ];
  const goals = [
    { key: 'a', name: 'alpha', cwd: 'D:/alpha', deadline: '2026-10-20 12:00:00', prompt: 'goal' },
  ];

  const rows = mergeDirectoryRows(topics, goals);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, topics[0]);
  assert.equal(rows[0].goal, goals[0]);
  assert.equal(rows[0].cwd, 'D:/alpha');
});

test('mergeDirectoryRows：CLI 先建 timegoal、目录尚无 localtask 时仍可显示', () => {
  const goal = { key: 'goal-only', name: 'gamma', cwd: 'D:/gamma', deadline: '2026-10-20 13:00:00' };
  const rows = mergeDirectoryRows([], [goal]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, null);
  assert.equal(rows[0].goal, goal);
  assert.equal(rows[0].name, 'gamma');
});

test('mergeDirectoryRows：全局池在最前，目录行不会重复', () => {
  const global = { key: '__GLOBAL__', name: '全局任务', cwd: '', isGlobal: true, pending: 2, total: 2 };
  const topics = [
    { key: 'b', name: 'beta', cwd: 'D:/beta', pending: 0, total: 0 },
    global,
    { key: 'a', name: 'alpha', cwd: 'D:/alpha', pending: 1, total: 1 },
  ];
  const goals = [{ key: 'a', name: 'alpha', cwd: 'D:/alpha', deadline: 'x' }];

  const rows = mergeDirectoryRows(topics, goals);
  assert.equal(rows[0].key, '__GLOBAL__');
  assert.deepEqual(rows.slice(1).map((r) => r.key), ['b', 'a'], '保留本地主题现有顺序');
  assert.equal(rows.filter((r) => r.key === 'a').length, 1);
  assert.equal(rows[2].goal, goals[0]);
});
