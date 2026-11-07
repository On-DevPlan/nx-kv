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
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-fork-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
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

test('重开派生新任务：新编号接着做，父保持 done，task_links 连接', async () => {
  const cwd = join(dir, 'p1');
  const { localtask, first, done } = await seed(cwd);

  const re = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮\n\n加暗色模式' });
  assert.equal(re.status, 'ok');
  assert.notEqual(re.id, first.task.id, '派生 = 新编号（每轮一个号）');
  assert.equal(re.forked, false);
  assert.equal(re.task.status, 'pending', '新任务立即可领');
  // 父任务定格：done 保持 done（上一轮交付事实不消失）
  const parent = await localtask.getTask({ cwd, id: first.task.id });
  assert.equal(parent.status, 'done', '父 done 保持不变');
  assert.equal(parent.completedAt, done.task.completedAt, '父交付时刻原样');
  assert.match(parent.text, /改登录页/, '父保留原正文（链可视化看每一轮的完整正文）');

  assert.match(re.task.text, /暗色模式/, '新任务带显式 text（面板拼好整篇回写的口径不变）');
  assert.equal(re.task.reopenCount, 1, 'round = 父.round + 1（视图 reopenCount = round-1）');
  assert.equal(re.parentId, first.task.id);

  // 链：task_links(src=新, dst=旧, type=reopen)
  const { links: linksRepo } = await import('../../src/modules/localtask/repo/index.js');
  const topicId = localtask.repo.topics.getTopic(localtask.normalizeCwd(cwd).key).id;
  const parentRow = localtask.repo.tasks.getTaskRow(topicId, first.task.id);
  assert.equal(linksRepo.hasParent(parentRow.row.id), false, '父没有来源');
  const kids = linksRepo.childLinks(parentRow.row.id);
  assert.equal(kids.length, 1, '父派生了一条');
  assert.equal(kids[0].type, 'reopen');
  assert.equal(kids[0].seq, re.id, '子任务 = 新派生的那条');
  // 链查询：一次递归拿整条
  const chain = linksRepo.chainOf(parentRow.row.id);
  assert.equal(chain.ancestors.length, 0, '父是根');
  assert.equal(chain.descendants.length, 1);
});

test('cancelled 不能重开；done 可多次重开成链 R1→R2→R3', async () => {
  const cwd = join(dir, 'p2');
  const { localtask, first } = await seed(cwd);
  const re1 = await localtask.reopenTask({ cwd, id: first.task.id, text: '# 第二轮' });
  assert.notEqual(re1.id, first.task.id, '派生新编号');
  const re2 = await localtask.reopenTask({ cwd, id: re1.id, text: '# 第三轮' });
  assert.notEqual(re2.id, re1.id, 'R2 再派生 R3');
  assert.equal(re2.task.reopenCount, 2, 'round 每轮 +1');

  // 链上三点：R1(done) → R2(cancelled？否——R2 被 R3 取代) …
  // 状态口径：done 父保持；claimed/pending 父 → cancelled + superseded
  const r1 = await localtask.getTask({ cwd, id: first.task.id });
  const r2 = await localtask.getTask({ cwd, id: re1.id });
  const r3 = await localtask.getTask({ cwd, id: re2.id });
  assert.equal(r1.status, 'done', 'R1 是 done 父 → 保持');
  assert.equal(r2.status, 'cancelled', 'R2 被 R3 取代 → cancelled');
  assert.equal(r3.status, 'pending', 'R3 是当前尖 → pending');

  // cancelled 行不能再重开（防止死记录复活）
  const cwd2 = join(dir, 'p2b');
  const seed2 = await seed(cwd2);
  const rr = await localtask.reopenTask({ cwd: cwd2, id: seed2.first.task.id, text: '# 先取消' });
  await localtask.repo.tasks.updateTaskByKey(
    localtask.normalizeCwd(cwd2).key, rr.id, { status: 'cancelled' }
  );
  await assert.rejects(
    () => localtask.reopenTask({ cwd: cwd2, id: rr.id, text: '# 不行' }),
    /已取消/,
  );
});

test('终态（done / cancelled）的上游不再挡住后来者', async () => {
  const { findFirstReadyPending } = await import('../../src/core/workflow/readiness.js');
  const cancelled = { id: 1, status: 'cancelled', completedAt: '', deletedAt: '', blockBy: [] };
  const follower = { id: 2, status: 'pending', deletedAt: '', blockBy: [1] };
  assert.equal(Number(findFirstReadyPending([cancelled, follower]).id), 2, '已取消的上游不再挡人');

  // done 同样不挡（终态 = 已了结）
  const done = { id: 1, status: 'done', completedAt: '2026-11-01 10:00:00', deletedAt: '', blockBy: [] };
  assert.equal(Number(findFirstReadyPending([done, follower]).id), 2, '已交付的上游不再挡人');

  // claimed（在干、没交付）**要**挡：闸门/依赖仍然有效
  const claimed = { id: 1, status: 'claimed', completedAt: '', deletedAt: '', blockBy: [] };
  assert.equal(findFirstReadyPending([claimed, follower]), null, '已领取未交付的上游继续挡人');
});

test('面板分桶：done / cancelled 各占一桶，都不算进行中', async () => {
  const { splitQueueTasks, sortTasksForDisplay } = await import(
    '../../src/web/frontend/modules/board/board-view.js'
  );
  const tasks = [
    { id: 1, status: 'pending' },
    { id: 2, status: 'claimed' },
    { id: 3, status: 'done' },
    { id: 4, status: 'cancelled' },
  ];
  const split = splitQueueTasks(tasks);
  assert.deepEqual(split.pending.map((t) => t.id), [1], '终态不在待领取里');
  assert.deepEqual(split.claimed.map((t) => t.id), [2], '已领取（在干）单列');
  assert.deepEqual(split.done.map((t) => t.id), [3], '已交付单列');
  assert.deepEqual(split.cancelled.map((t) => t.id), [4], '已取消单列');
  assert.deepEqual(sortTasksForDisplay(tasks).map((t) => t.id), [1, 2, 3, 4]);
});

test('就地重开保留时间目标声明（再次领取重新计时）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'p4');
  mkdirSync(cwd, { recursive: true });
  const added = await localtask.addTask({ text: '带时限的活', cwd, timegoal: { duration: '2h' } });
  assert.equal(added.task.timegoal.duration, '2h');

  const re = await localtask.reopenTask({ cwd, id: added.task.id, text: '# 第二轮' });
  assert.notEqual(re.id, added.task.id, '派生新编号');
  assert.equal(re.task.timegoal.duration, '2h', '时间目标声明跟着活走');
});

test('comment kind 也派生新任务（type=comment），反馈段跟正文走', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'p5');
  mkdirSync(cwd, { recursive: true });
  const added = await localtask.addTask({ text: '# 原文\n\n做某事', cwd });
  const re = await localtask.reopenTask({
    cwd,
    id: added.task.id,
    kind: 'comment',
    feedback: '这里不对',
  });
  assert.equal(re.status, 'ok');
  assert.notEqual(re.id, added.task.id, 'comment 也派生新编号');
  assert.equal(re.kind, 'comment');
  assert.match(re.task.text, /这里不对/, '反馈段跟正文走');

  // 链上的 type=comment
  const { links: linksRepo } = await import('../../src/modules/localtask/repo/index.js');
  const topicId = localtask.repo.topics.getTopic(localtask.normalizeCwd(cwd).key).id;
  const parentRow = localtask.repo.tasks.getTaskRow(topicId, added.task.id);
  const kids = linksRepo.childLinks(parentRow.row.id);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].type, 'comment');
});

test('搬队列：带链任务（R1→R2）搬后链完整，全局 id 不变', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const cwdA = join(dir, 'mv-a');
  const cwdB = join(dir, 'mv-b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
  await localtask.addTask({ text: 'R1', cwd: cwdA });
  const r1 = await waitForTask({ cwd: cwdA, summary: 's', timeoutSec: 1, open: false });
  await localtask.completeTask({ cwd: cwdA, id: r1.task.id, summary: 'R1 完成' });
  const r2 = await localtask.reopenTask({ cwd: cwdA, id: r1.task.id, text: 'R2' });

  // R2 搬到 B 队列
  const upd = await localtask.updateTask({ cwd: cwdA, id: r2.id, moveTo: { cwd: cwdB } });
  assert.equal(upd.moved, true);

  // 链完整性：全局 id 不变（单条 UPDATE 保留 id，task_links/task_deps 自动跟随）
  const { db: dbFn } = await import('../../src/modules/localtask/repo/index.js');
  const bid = localtask.repo.topics.ensureTopic(localtask.normalizeCwd(cwdB).key, { cwd: cwdB }).id;
  // 搬队列的链：type='reopen'，src = B 里的新任务
  const moveLink = dbFn().get(
    "SELECT src_id, dst_id FROM task_links WHERE note LIKE 'moved to%' ORDER BY created_at DESC LIMIT 1"
  );
  assert.ok(moveLink, '搬队列链存在');
  const srcInB = dbFn().get('SELECT topic_id FROM tasks WHERE id = :id', { id: moveLink.src_id });
  assert.equal(srcInB.topic_id, bid, 'src 已搬到 B');

  // 原始 reopen 链（R1→R2）也没被 CASCADE 删掉：全局 id 保留了
  const reopenLink = dbFn().get(
    "SELECT src_id, dst_id FROM task_links WHERE note = '' ORDER BY created_at LIMIT 1"
  );
  assert.ok(reopenLink, 'R1→R2 链仍存在');
  const dstOfReopen = dbFn().get('SELECT topic_id FROM tasks WHERE id = :id', { id: reopenLink.dst_id });
  assert.notEqual(dstOfReopen.topic_id, bid, 'dst 仍在 A');

  // taskChain 从搬入任务查：整条链可达（R1 在祖先里）
  const chain = await localtask.taskChain({ cwd: cwdB, id: upd.task.id });
  assert.ok(chain.ancestors.length >= 1, 'R1 仍在祖先链里');
  const ancestorIds = chain.ancestors.map((a) => a.id);
  assert.ok(ancestorIds.includes(r1.task.id), '祖先链里有 R1');
});

test('搬队列：源 order 摘除、目标 order 追加', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwdA = join(dir, 'mv-ord-a');
  const cwdB = join(dir, 'mv-ord-b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
  await localtask.addTask({ text: 'A1', cwd: cwdA });
  await localtask.addTask({ text: 'A2', cwd: cwdA });
  const moved = await localtask.updateTask({ cwd: cwdA, id: 1, moveTo: { cwd: cwdB } });
  assert.equal(moved.task.id, 1, '无冲突 → 保持同号（全局 id 不变）');

  const a = localtask.repo.topics.getTopic(localtask.normalizeCwd(cwdA).key);
  const b = localtask.repo.topics.getTopic(localtask.normalizeCwd(cwdB).key);
  assert.ok(!a.ext.ext_task_order?.includes(1), '源 order 摘除');
  assert.ok(b.ext.ext_task_order?.includes(1), '目标 order 追加');
  assert.equal(b.ext.ext_task_order.at(-1), 1, '追加到尾');
});

test('搬队列：目标队列同号冲突 → 重编号，旧号在返回值', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwdA = join(dir, 'mv-clash-a');
  const cwdB = join(dir, 'mv-clash-b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
  await localtask.addTask({ text: 'A 的', cwd: cwdA });
  await localtask.addTask({ text: 'B 占位', cwd: cwdB });
  const upd = await localtask.updateTask({ cwd: cwdA, id: 1, moveTo: { cwd: cwdB } });
  assert.equal(upd.moved, true);
  assert.notEqual(upd.task.id, 1, '同号 → 重编号');
  assert.equal(upd.movedFrom.id, 1, '旧号在返回值');
});

test('搬队列后闸门位置按目标队列 order 判定', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { isReadyToClaim } = await import('../../src/core/workflow/readiness.js');
  const cwdA = join(dir, 'mv-gate-a');
  const cwdB = join(dir, 'mv-gate-b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
  await localtask.addTask({ text: '闸门', cwd: cwdB, blocksFollowing: true });
  const gate = await localtask.getTask({ cwd: cwdB, id: 1 });
  assert.equal(gate.blocksFollowing, true, '闸门就位');
  await localtask.addTask({ text: '后续', cwd: cwdB });
  await localtask.addTask({ text: '要搬的', cwd: cwdA });
  // 搬到 B 队列：闸门后面
  const moved = await localtask.updateTask({ cwd: cwdA, id: 1, moveTo: { cwd: cwdB } });
  assert.equal(moved.moved, true);
  // 闸门在 B 队列 order 里排在搬入任务前面 → 搬入任务被挡
  const rows = localtask.repo.topics.getTopic(localtask.normalizeCwd(cwdB).key).tasks.filter((x) => !x.deletedAt);
  const movedRow = rows.find((x) => x.id === moved.task.id);
  assert.equal(isReadyToClaim(movedRow, rows), false, '闸门挡住搬入任务');
});
