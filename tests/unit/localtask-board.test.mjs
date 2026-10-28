import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDirectoryRows,
  withGlobalRow,
  globalPlaceholderTopic,
  splitQueueTasks,
  GLOBAL_KEY,
} from '../../src/modules/localtask/board.js';

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

test('withGlobalRow：全局池空着也补一行占位，用户永远找得到往池子里加任务的入口', () => {
  const rows = mergeDirectoryRows([], []);
  assert.equal(rows.length, 0, 'mergeDirectoryRows 本身不造全局行（纯函数，契约不变）');

  const withGlobal = withGlobalRow(rows);
  assert.equal(withGlobal.length, 1);
  assert.equal(withGlobal[0].key, GLOBAL_KEY);
  assert.equal(withGlobal[0].isGlobal, true);
  assert.equal(withGlobal[0].placeholder, true);
  assert.equal(withGlobal[0].topic, null);
  assert.equal(withGlobal[0].name, '全局任务');
});

test('withGlobalRow：已有真全局主题时不重复补行', () => {
  const global = { key: GLOBAL_KEY, name: '全局任务', cwd: '', isGlobal: true, pending: 2, total: 2 };
  const rows = mergeDirectoryRows([global], []);
  const withGlobal = withGlobalRow(rows);
  assert.equal(withGlobal.length, 1);
  assert.equal(withGlobal[0].topic, global, '用真主题，不用占位');
  assert.equal(withGlobal[0].placeholder, undefined);
});

test('withGlobalRow：占位行排在最前（全局池是所有 worker 的候补来源）', () => {
  const local = { key: 'a', name: 'alpha', cwd: 'D:/alpha', pending: 1, total: 1 };
  const rows = withGlobalRow(mergeDirectoryRows([local], []));
  assert.equal(rows[0].key, GLOBAL_KEY);
  assert.equal(rows[1].key, 'a');
});

test('globalPlaceholderTopic：空池子也能直接拿来当投递目标', () => {
  const t = globalPlaceholderTopic();
  assert.equal(t.key, GLOBAL_KEY);
  assert.equal(t.isGlobal, true);
  assert.equal(t.cwd, '');
  assert.equal(t.total, 0);
  assert.equal(t.pending, 0);
  assert.deepEqual(t.tasks, []);
  assert.equal(t.waiting, false);
});

// ─── 队列拆分：软删除的任务不许留在待领取里 ─────────────────────────────
//
// 回归的真实场景：用户软删了全局池里一条任务（#38），面板的「待领取」列表
// 却仍然显示它 —— 因为视图只按 status 过滤、没排除 deletedAt。点删除也毫无
// 变化（deletedAt 被设成同一个值），于是「这个任务我删不掉」。
// 服务端派发本来就按 `!deletedAt` 过滤，所以只有面板这层错；这里把口径钉死。

test('splitQueueTasks：软删除的任务不在待领取、也不在已领取里', () => {
  const tasks = [
    { id: 1, status: 'pending', deletedAt: '' },
    { id: 2, status: 'consumed', deletedAt: '' },
    { id: 3, status: 'pending', deletedAt: '2026-10-22 21:05:44' }, // 软删除但还没被领
    { id: 4, status: 'consumed', deletedAt: '2026-10-22 21:05:44' }, // 软删除且已领
  ];
  const { pending, consumed, deleted } = splitQueueTasks(tasks);

  assert.deepEqual(pending.map((t) => t.id), [1], '待领取里不能有软删除的任务');
  assert.deepEqual(consumed.map((t) => t.id), [2], '已领取里也不能有软删除的任务');
  assert.deepEqual(deleted.map((t) => t.id), [4, 3], '已删除区按倒序（新的在上面）');
});

test('splitQueueTasks：待领取按领取优先级（数组原序，不反转）', () => {
  const tasks = [
    { id: 10, status: 'pending' },
    { id: 11, status: 'pending' },
    { id: 12, status: 'pending' },
  ];
  const { pending } = splitQueueTasks(tasks);
  assert.deepEqual(pending.map((t) => t.id), [10, 11, 12], '#1 -> #2 -> #3，顺序即领取优先级');
});

test('splitQueueTasks：空输入与脏输入都不炸', () => {
  assert.deepEqual(splitQueueTasks([]), { pending: [], consumed: [], deleted: [], migrated: [] });
  assert.deepEqual(splitQueueTasks(null), { pending: [], consumed: [], deleted: [], migrated: [] });
  assert.deepEqual(splitQueueTasks(undefined), { pending: [], consumed: [], deleted: [], migrated: [] });
});
