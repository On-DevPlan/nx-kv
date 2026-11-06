import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDirectoryRows,
  withGlobalRow,
  globalPlaceholderTopic,
  splitQueueTasks,
  sortTasksForDisplay,
  isGroupTask,
  projectTasks,
  projectPending,
  taskInBoard,
  GLOBAL_KEY,
} from '../../src/web/frontend/modules/board/board-view.js';
import { normalizeTask } from '../../src/modules/localtask/task-view.js';

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
  const empty = { pending: [], consumed: [], archived: [], deleted: [], migrated: [] };
  assert.deepEqual(splitQueueTasks([]), empty);
  assert.deepEqual(splitQueueTasks(null), empty);
  assert.deepEqual(splitQueueTasks(undefined), empty);
});

// ─── 显示序：未完成优先（2026-11-03 反馈「优先显示没有完成的任务」）──────
//
// 真实场景：队列是**追加序**（谁先提交谁在前），新任务会被几十条历史埋在
// 下面——用户加完活儿在列表里找不到它。显示序与队列序分开：显示时把待领取
// 提到最前，其余沉到后面；**领取优先级不变**（待领取桶内仍是队列原序）。

test('sortTasksForDisplay：待领取提到最前，已领取/已迁出/已删除依次下沉', () => {
  const tasks = [
    { id: 1, status: 'consumed' },
    { id: 2, status: 'pending' },
    { id: 3, status: 'consumed' },
    { id: 4, status: 'pending' },
    { id: 5, status: 'pending', migratedTo: { side: 'cloud', topic: 't', targetId: 9 } },
    { id: 6, status: 'pending', deletedAt: '2026-11-03 10:00:00' },
  ];
  const sorted = sortTasksForDisplay(tasks);
  assert.deepEqual(
    sorted.map((t) => t.id),
    [2, 4, 3, 1, 5, 6],
    '待领取（队列原序）→ 已领取（倒序）→ 已迁出 → 已删除（倒序）'
  );
});

test('sortTasksForDisplay：待领取内部保持队列原序（领取优先级不能乱）', () => {
  const tasks = [
    { id: 7, status: 'pending' },
    { id: 8, status: 'consumed' },
    { id: 9, status: 'pending' },
    { id: 10, status: 'pending' },
  ];
  assert.deepEqual(sortTasksForDisplay(tasks).map((t) => t.id), [7, 9, 10, 8]);
});

test('sortTasksForDisplay：不改传入数组（纯函数）', () => {
  const tasks = [
    { id: 1, status: 'consumed' },
    { id: 2, status: 'pending' },
  ];
  sortTasksForDisplay(tasks);
  assert.deepEqual(tasks.map((t) => t.id), [1, 2], '原数组顺序不变');
});

test('sortTasksForDisplay：空输入与脏输入都不炸', () => {
  assert.deepEqual(sortTasksForDisplay([]), []);
  assert.deepEqual(sortTasksForDisplay(null), []);
  assert.deepEqual(sortTasksForDisplay(undefined), []);
});

// ─── 两种走向（任务 #85）：组任务的标注与项目侧分流 ─────────────────────
//
// 组任务（正文 frontmatter 带 board）物理上落在项目队列里（领取流程按目录领），
// 但**走向**属于组：项目侧的列表与计数剔除，组页按 board 归属认领。
// 服务端 normalizeTask 负责标注 boardMark；前端读标注分流，不重复解析正文。

test('normalizeTask：frontmatter.board 标到 boardMark；没有/坏块都是空串', () => {
  const marked = normalizeTask({
    id: 1,
    status: 'pending',
    text: '---\nboard: b_mvwc2mzrwnlby\nproject: local/nx-kv\n---\n\n# 组任务\n',
  });
  assert.equal(marked.boardMark, 'b_mvwc2mzrwnlby');

  const plain = normalizeTask({ id: 2, status: 'pending', text: '# 普通项目任务\n\n正文' });
  assert.equal(plain.boardMark, '');

  // 文档以 --- 开头的分割线不算 frontmatter（无 key: value 行 → 空对象）
  const noFm = normalizeTask({ id: 3, status: 'pending', text: '---\n只是分割线\n---\n正文' });
  assert.equal(noFm.boardMark, '');

  const empty = normalizeTask({ id: 4 });
  assert.equal(empty.boardMark, '');
});

test('normalizeTask：board 值两边空白裁掉（手写 frontmatter 容错）', () => {
  const t = normalizeTask({ id: 5, status: 'pending', text: '---\nboard:   b_x  \n---\n# 手写' });
  assert.equal(t.boardMark, 'b_x');
});

test('isGroupTask：只认 boardMark 标注', () => {
  assert.equal(isGroupTask({ boardMark: 'b1' }), true);
  assert.equal(isGroupTask({ boardMark: '' }), false);
  assert.equal(isGroupTask({}), false);
  assert.equal(isGroupTask(null), false);
});

test('projectTasks / projectPending：组任务与软删除都不在项目走向里', () => {
  const tasks = [
    { id: 1, status: 'pending', boardMark: '' },
    { id: 2, status: 'pending', boardMark: 'b1' }, // 组任务 → 组页管
    { id: 3, status: 'pending', deletedAt: 'x' }, // 软删除 → 不可见
    { id: 4, status: 'consumed' }, // 已领取：不算待领取，但留在项目侧列表
    { id: 5, status: 'archived', boardMark: 'b1' }, // 组任务 + 归档 → 彻底不可见
    { id: 6, status: 'pending', migratedTo: { side: 'cloud' } }, // 迁出 tombstone
  ];
  assert.deepEqual(projectTasks(tasks).map((t) => t.id), [1, 4, 6], '项目走向列表：剔除组任务与软删除（迁出 tombstone 留着，只是不算待领取）');
  assert.equal(projectPending(tasks), 1, '项目走向待领取：只剩纯项目任务');
});

test('taskInBoard：id / key / name 三种身份都认；不匹配的组不算', () => {
  const byId = { status: 'pending', boardMark: 'b_mvwc2mzrwnlby' };
  assert.equal(taskInBoard(byId, { id: 'b_mvwc2mzrwnlby', key: 'nx', name: 'nx' }), true);
  assert.equal(taskInBoard(byId, { id: 'b_x', key: 'other', name: '别的组' }), false);
  // 手写 frontmatter 给的是组名/key，不是面板写的 id
  const byName = { status: 'pending', boardMark: 'nx' };
  assert.equal(taskInBoard(byName, { id: 'b_other', key: 'nx', name: '别的组' }), true, 'key 也认');
  assert.equal(taskInBoard(byName, { id: 'b_other', key: 'other', name: 'nx' }), true, 'name 也认');
  assert.equal(taskInBoard({ boardMark: '' }, { id: 'b_mvwc2mzrwnlby' }), false);
});
