// 面板「标为完成 / 取消」的服务端语义（#184）。
//
// 背景：`closeTasks` 原先只放行 pending —— 正在跑（claimed）的任务在面板上没有任何
// 收口入口，用户必须干等 agent 自己回执。这里把守卫放宽到 `pending ∨ claimed`，
// 本文件锁住三条边界：
//   1. pending → done：默认总结说明「未领取就直接关闭」；
//   2. claimed → done：这是 #184 的核心路径，写用户的总结、记 claimedClosed，
//      并保留 claimed_* 审计列（谁领的仍查得到）；agent 之后再调 done 走幂等分支；
//   3. 终态（done / cancelled / deleted）一律跳过、历史不被改写。
//
// 存储指向临时文件（NX_KV_LOCALTASK_STORE），绝不写用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-close-'));
const storeFile = join(tmp, 'localtasks.json');
const dir = join(tmp, 'proj');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_CONFIG = join(tmp, 'config.json'); // 隔离登录态，不触网

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

const key = svc.normalizeCwd(dir).key;

/** 取主题里某条任务的当前行（listTasks 的出站形状）。 */
async function row(id) {
  const d = await svc.listTasks();
  const t = (d.topics || []).find((x) => x.key === key);
  return (t?.tasks || []).find((x) => Number(x.id) === Number(id)) || null;
}

test('closeTasks：待领取任务直接标完成，默认总结写明「未领取」', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: '队列里没人领的任务' });
  const id = added.task.id;

  const res = await svc.closeTasks({ cwd: dir, ids: [id], status: 'done' });
  assert.equal(res.count, 1);
  assert.deepEqual(res.claimedClosed, [], '待领取的不算 claimedClosed');
  assert.deepEqual(res.skipped, []);

  const r = await row(id);
  assert.equal(r.status, 'done');
  assert.match(r.feedback, /用户确认已完成（任务未领取，直接关闭）/);
});

test('closeTasks：已领取（正在跑）的任务也能标完成 —— #184 核心路径', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: 'agent 正在跑的任务' });
  const id = added.task.id;
  const claimed = await svc.consumeFirstPending(key, '正在改 ref 同步', { key: 'k1', name: 'agent-A' });
  assert.equal(claimed.status, 'claimed');

  const res = await svc.closeTasks({ cwd: dir, ids: [id], status: 'done', summary: '用户在面板验收通过' });
  assert.equal(res.count, 1);
  assert.deepEqual(res.claimedClosed, [id], 'claimed 收口要如实回报');

  const r = await row(id);
  assert.equal(r.status, 'done');
  assert.equal(r.feedback, '用户在面板验收通过', '用用户写的总结，不覆盖成默认文案');
  assert.equal(r.claimedByName, 'agent-A', 'claimed_* 审计列必须保留');
  assert.ok(r.doneAt, '完成时刻要写');
});

test('closeTasks：已领取且不写总结时，默认总结点明「面板直接收口」与领取方', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: '有领取方的任务' });
  const id = added.task.id;
  await svc.consumeFirstPending(key, '现状', { name: 'agent-B' });

  await svc.closeTasks({ cwd: dir, ids: [id], status: 'done' });
  const r = await row(id);
  assert.match(r.feedback, /面板直接收口/);
  assert.match(r.feedback, /agent-B/);
});

test('closeTasks：已被 agent 收口的任务再点一次 = 跳过，历史不被改写', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: 'agent 已经交付的任务' });
  const id = added.task.id;
  await svc.consumeFirstPending(key, '开始', { name: 'agent-C' });
  await svc.completeTask({ cwd: dir, id, summary: 'agent 的交付结论' });

  const res = await svc.closeTasks({ cwd: dir, ids: [id], status: 'done', summary: '用户手滑又点了一次' });
  assert.equal(res.count, 0);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].status, 'done');
  assert.equal(res.skipped[0].reason, 'already_closed');

  const r = await row(id);
  assert.equal(r.feedback, 'agent 的交付结论', '终态反馈不许被二次点击覆盖');
});

test('closeTasks：已删除 / 已取消同样跳过（reason 区分）', async () => {
  await svc.resetLocaltaskStore();
  const a = await svc.addTask({ cwd: dir, text: '被取消的任务' });
  const b = await svc.addTask({ cwd: dir, text: '被软删的任务' });
  await svc.closeTasks({ cwd: dir, ids: [a.task.id], status: 'cancelled' });
  await svc.removeTask({ cwd: dir, id: b.task.id });

  const res = await svc.closeTasks({ cwd: dir, ids: [a.task.id, b.task.id], status: 'done' });
  assert.equal(res.count, 0);
  const reasons = Object.fromEntries(res.skipped.map((x) => [x.id, x.reason]));
  assert.equal(reasons[a.task.id], 'already_closed');
  assert.equal(reasons[b.task.id], 'deleted');
});

test('closeTasks：--status cancelled 对已领取的任务也生效（CLI 侧收口）', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: '决定不做了的任务' });
  const id = added.task.id;
  await svc.consumeFirstPending(key, '现状', { name: 'agent-D' });

  const res = await svc.closeTasks({ cwd: dir, ids: [id], status: 'cancelled' });
  assert.equal(res.count, 1);
  assert.equal(res.closeStatus, 'cancelled');
  const r = await row(id);
  assert.equal(r.status, 'cancelled');
  // 取消不动 feedback：保留领取时写下的现状（'现状'），不覆盖成一笔「完成总结」
  assert.equal(r.feedback, '现状');
  assert.ok(!r.doneAt, '取消不算完成，不写完成时刻');
});
