// **任务状态单向 + 重开即新建**（任务 #59）：
//
//   pending → consumed（已领取）→ archived（终态：被新任务取代）
//
// 没有回退边：完成等待验收之后不会回到「重新开始」；重做 / 加评论一律**新建
// 一条任务**（新的 md），旧任务归档留档（正文、完成总结、完成标记都不动）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-fork-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_TIMEGOAL_STORE = join(dir, 'timegoals.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function seed(cwd) {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  mkdirSync(cwd, { recursive: true });
  await localtask.addTask({ text: '改登录页', cwd });
  const first = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(first.status, 'ok');
  const done = await localtask.completeTask({ cwd, id: first.task.id, summary: '第一轮完成' });
  assert.equal(done.status, 'ok');
  return { localtask, first, done };
}

test('重开产出新任务：旧任务归档，正文 / 完成总结 / 完成标记都留档', async () => {
  const cwd = join(dir, 'p1');
  const { localtask, first, done } = await seed(cwd);

  const re = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮\n\n加暗色模式' });
  assert.equal(re.status, 'ok');
  assert.notEqual(re.id, first.task.id, '是新任务，不是同一条');
  assert.equal(re.task.status, 'pending');
  assert.match(re.task.text, /暗色模式/);
  assert.equal(re.from.id, first.task.id, '指回上一条');

  // 旧任务：终态 + 留档
  assert.equal(re.archived.status, 'archived');
  assert.equal(re.archived.completedAt, done.task.completedAt);
  assert.equal(re.archived.roundSummary, '第一轮完成');
  assert.equal(re.archived.text.trim(), '改登录页');
  assert.equal(re.archived.supersededBy.id, re.id, '记着被哪一条取代');
});

test('归档是终态：不能再重开、也不再算待领取', async () => {
  const cwd = join(dir, 'p2');
  const { localtask, first } = await seed(cwd);
  const re = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮' });

  await assert.rejects(
    () => localtask.reopenTask({ cwd, id: first.task.id, text: '# 第三轮' }),
    /已归档/,
    '归档任务不能再重开',
  );

  const { isPending } = await import('../../src/modules/localtask/task-view.js');
  const listed = await localtask.listTasks();
  const topic = (listed.topics || []).find((t) => String(t.cwd) === String(cwd));
  assert.ok(topic, '主题在总览里');
  const old = (topic.tasks || []).find((t) => Number(t.id) === Number(first.task.id));
  const fresh = (topic.tasks || []).find((t) => Number(t.id) === Number(re.id));
  assert.equal(old.status, 'archived');
  assert.equal(isPending(old), false, '归档不再算待领取');
  assert.equal(isPending(fresh), true);
});

test('归档的上游不再挡住后来者（终态 = 已了结）', async () => {
  const { findFirstReadyPending } = await import('../../src/core/workflow/readiness.js');
  const archived = { id: 1, status: 'archived', completedAt: '', deletedAt: '', blockBy: [] };
  const follower = { id: 2, status: 'pending', deletedAt: '', blockBy: [1] };

  // 归档 = 了结：依赖它的人不再被挡
  const ready = findFirstReadyPending([archived, follower]);
  assert.ok(ready, '归档的上游不再挡住后来者');
  assert.equal(Number(ready.id), 2);
});

test('面板分桶：归档单列一桶，不再算进行中', async () => {
  const { splitQueueTasks, sortTasksForDisplay } = await import('../../src/web/frontend/modules/board/board-view.js');
  const tasks = [
    { id: 1, status: 'pending' },
    { id: 2, status: 'consumed' },
    { id: 3, status: 'archived' },
  ];
  const split = splitQueueTasks(tasks);
  assert.deepEqual(split.pending.map((t) => t.id), [1], '归档不在待领取里');
  assert.deepEqual(split.consumed.map((t) => t.id), [2]);
  assert.deepEqual(split.archived.map((t) => t.id), [3]);
  // 显示序：待领取 → 已领取 → 已归档（沉底）
  assert.deepEqual(sortTasksForDisplay(tasks).map((t) => t.id), [1, 2, 3]);
});

test('新任务继承同一件活的约束：时间目标（新一轮从再次领取重新计时）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'p4');
  mkdirSync(cwd, { recursive: true });
  const added = await localtask.addTask({ text: '带时限的活', cwd, timegoal: { duration: '2h' } });
  assert.equal(added.task.timegoal.duration, '2h');

  const re = await localtask.reopenTask({ cwd, id: added.task.id, text: '# 第二轮' });
  assert.notEqual(re.id, added.task.id);
  assert.equal(re.task.timegoal.duration, '2h', '时间目标跟着活走');
  assert.equal(re.archived.timegoal.duration, '2h', '旧任务也留档');
});
