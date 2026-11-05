// **就地重开 + history 链**（任务 #74）：
//
//   pending → consumed（已领取）→（完成）→ 就地回 pending（history 留档）
//
// 不再新建 md / 归档取代（#59 旧口径仅保留对已 archived 行的拒绝）。
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

test('重开回写原任务：编号不变，history 留档，完成态清掉', async () => {
  const cwd = join(dir, 'p1');
  const { localtask, first, done } = await seed(cwd);

  const re = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮\n\n加暗色模式' });
  assert.equal(re.status, 'ok');
  assert.equal(re.id, first.task.id, '就地重开，不是新编号');
  assert.equal(re.forked, false);
  assert.equal(re.task.status, 'pending');
  assert.match(re.task.text, /暗色模式/);
  assert.equal(re.task.completedAt, '');
  assert.ok(re.task.history.length >= 2, '至少 origin + 本轮事件');
  assert.equal(re.task.history[0].kind, 'origin');
  assert.equal(re.task.history[0].text.trim(), '改登录页');
  assert.equal(re.task.history[0].summary, '第一轮完成');
  assert.equal(re.task.history[0].completedAt, done.task.completedAt);
  assert.equal(re.task.history.at(-1).kind, 'reopen');
});

test('已归档（旧 fork 残留）不能再重开；就地重开可多次', async () => {
  const cwd = join(dir, 'p2');
  const { localtask, first } = await seed(cwd);
  const re1 = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮' });
  assert.equal(re1.id, first.task.id);

  const re2 = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第三轮' });
  assert.equal(re2.id, first.task.id);
  assert.ok(re2.task.history.length >= 3);

  // 手工把任务标成 archived（模拟 #59 残留）→ 拒绝
  const storePath = process.env.NX_KV_LOCALTASK_STORE;
  const { readFileSync, writeFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(storePath, 'utf8'));
  const topic = Object.values(raw.topics).find((t) => String(t.cwd) === String(cwd));
  const row = topic.tasks.find((x) => Number(x.id) === Number(first.task.id));
  row.status = 'archived';
  row.archivedReason = 'superseded';
  writeFileSync(storePath, JSON.stringify(raw));

  await assert.rejects(
    () => localtask.reopenTask({ cwd, id: first.task.id, text: '# 不行' }),
    /已归档/,
  );
});

test('归档的上游不再挡住后来者（终态 = 已了结）', async () => {
  const { findFirstReadyPending } = await import('../../src/core/workflow/readiness.js');
  const archived = { id: 1, status: 'archived', completedAt: '', deletedAt: '', blockBy: [] };
  const follower = { id: 2, status: 'pending', deletedAt: '', blockBy: [1] };

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
  assert.deepEqual(sortTasksForDisplay(tasks).map((t) => t.id), [1, 2, 3]);
});

test('就地重开保留时间目标声明（再次领取重新计时）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'p4');
  mkdirSync(cwd, { recursive: true });
  const added = await localtask.addTask({ text: '带时限的活', cwd, timegoal: { duration: '2h' } });
  assert.equal(added.task.timegoal.duration, '2h');

  const re = await localtask.reopenTask({ cwd, id: added.task.id, text: '# 第二轮' });
  assert.equal(re.id, added.task.id);
  assert.equal(re.task.timegoal.duration, '2h', '时间目标跟着活走');
});

test('comment kind 写入 history；同号回写', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'p5');
  mkdirSync(cwd, { recursive: true });
  const added = await localtask.addTask({ text: '# 原文\n\n做某事', cwd });
  const re = await localtask.reopenTask({
    cwd,
    id: added.task.id,
    kind: 'comment',
    quote: '做某事',
    feedback: '这里要拆细',
    text: '# 原文\n\n做某事\n\n## 反馈修改\n\n**这里要拆细**\n',
  });
  assert.equal(re.kind, 'comment');
  assert.equal(re.id, added.task.id);
  assert.equal(re.task.status, 'pending');
  assert.equal(re.task.history.at(-1).kind, 'comment');
  assert.equal(re.task.history.at(-1).quote, '做某事');
});
