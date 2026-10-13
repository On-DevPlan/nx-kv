// 全局主题（共享池）测试：本地空 → wait 自动领全局（工作窃取）；本地优先；同进程
// FIFO 唤醒；跨进程轮询兜底；全局主题受保护（prune/remove 默认跳过）且永不等待。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-localtask-global-'));
const storeFile = join(tmp, 'localtasks.json');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function reset() {
  try {
    rmSync(storeFile);
  } catch {
    /* 不存在即可 */
  }
  // 关掉收尾追加语，保持 task.text 的精确相等断言
  await svc.updateSettings({ taskSuffix: '' });
}

test('addTask global:true 落到全局主题；列表置顶且 isGlobal:true', async () => {
  await reset();
  // 先建一个本地主题（更晚更新），验证排序时全局仍应在前
  await svc.addTask({ cwd: dirA, text: '本地任务' });
  const r = await svc.addTask({ global: true, text: '共享任务' });
  assert.equal(r.key, svc.GLOBAL_KEY);
  assert.equal(r.cwd, '');
  assert.equal(r.name, svc.GLOBAL_NAME);
  assert.equal(r.isGlobal, true);
  assert.equal(r.queued, true); // 无人等待 → 入队堆积

  const ov = await svc.listTasks();
  assert.equal(ov.topics[0].key, svc.GLOBAL_KEY);
  assert.equal(ov.topics[0].isGlobal, true);
  assert.equal(ov.topics[0].pending, 1);
  assert.equal(ov.topics[0].waiting, false); // 全局永不等待
});

test('addTask global:true 与 --cwd 同给 → global 优先，cwd 被忽略（不建本地主题）', async () => {
  await reset();
  const r = await svc.addTask({ cwd: dirA, global: true, text: '只进全局' });
  assert.equal(r.key, svc.GLOBAL_KEY);
  const ov = await svc.listTasks();
  assert.equal(ov.topics.length, 1);
  assert.equal(ov.topics[0].key, svc.GLOBAL_KEY);
});

test('显式传 cwd 的 wait 也自动领全局（cwd 不关闭兜底）：本地空 → source global', async () => {
  await reset();
  await svc.addTask({ global: true, text: '池子里的活' });
  const r = await svc.waitForTask({ cwd: dirA, summary: '本地空等全局', open: false });
  assert.equal(r.status, 'ok');
  assert.equal(r.queued, true);
  assert.equal(r.source, 'global');
  assert.equal(r.task.text, '池子里的活');
  assert.equal(r.key, svc.normalizeCwd(dirA).key); // 视角字段仍是 agent 自己的主题
  assert.equal(r.cwd, svc.normalizeCwd(dirA).cwd);
});

test('本地与全局都有 pending → 优先本地（source local）', async () => {
  await reset();
  await svc.addTask({ global: true, text: '全局的' });
  await svc.addTask({ cwd: dirA, text: '本地的' });
  const r = await svc.waitForTask({ cwd: dirA, summary: '现状', open: false });
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'local');
  assert.equal(r.task.text, '本地的');
  // 全局任务原封不动留在池里
  const ov = await svc.listTasks();
  const g = ov.topics.find((t) => t.isGlobal);
  assert.equal(g.pending, 1);
});

test('本地空 + 全局空 → 阻塞；同进程 addTask(global) 按 FIFO 实时唤醒', async () => {
  await reset();
  let fire;
  const ready = new Promise((r) => {
    fire = r;
  });
  const p = svc.waitForTask({
    cwd: dirA,
    summary: '两边都空',
    timeoutSec: 10,
    open: false,
    onReady: () => fire(), // onReady 在 waiter 注册之后调用 → 此后投递必走 delivered 路径
  });
  await ready;
  const added = await svc.addTask({ global: true, text: '实时全局' });
  assert.equal(added.delivered, true);
  assert.equal(added.queued, false);

  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'global');
  assert.equal(r.delivered, true);
  assert.equal(r.queued, false);
  assert.equal(r.task.text, '实时全局');
  assert.equal(r.task.roundSummary, '两边都空'); // 全局领取也记录本轮完成总结
});

test('FIFO：两个 wait 先后阻塞，两条全局任务按阻塞顺序各领一条', async () => {
  await reset();
  let fire1;
  let fire2;
  const ready1 = new Promise((r) => {
    fire1 = r;
  });
  const ready2 = new Promise((r) => {
    fire2 = r;
  });
  const p1 = svc.waitForTask({ cwd: dirA, summary: 'A 等', timeoutSec: 10, open: false, onReady: () => fire1() });
  await ready1; // 先保证 waiter1 已注册，再启动 waiter2 → 注册顺序确定
  const p2 = svc.waitForTask({ cwd: dirB, summary: 'B 等', timeoutSec: 10, open: false, onReady: () => fire2() });
  await ready2;

  const a1 = await svc.addTask({ global: true, text: 'G-给先来的' });
  const a2 = await svc.addTask({ global: true, text: 'G-给后来的' });
  assert.equal(a1.delivered, true);
  assert.equal(a2.delivered, true);

  const w1 = await p1;
  const w2 = await p2;
  assert.equal(w1.task.text, 'G-给先来的');
  assert.equal(w2.task.text, 'G-给后来的');
  assert.equal(w1.source, 'global');
  assert.equal(w2.source, 'global');
});

test('跨进程兜底：wait 阻塞中，另一进程直接写 store 投全局任务 → 轮询领取（source global）', async () => {
  await reset();
  let fire;
  const ready = new Promise((r) => {
    fire = r;
  });
  const p = svc.waitForTask({ cwd: dirA, summary: '等跨进程', timeoutSec: 10, open: false, onReady: () => fire() });
  await ready;

  // 模拟另一个进程：直接覆写 store 文件，往全局主题塞一条 pending
  const raw = JSON.parse(readFileSync(storeFile, 'utf8'));
  raw.topics[svc.GLOBAL_KEY] = {
    key: svc.GLOBAL_KEY,
    cwd: '',
    name: svc.GLOBAL_NAME,
    summary: '',
    createdAt: svc.stampNow(),
    updatedAt: svc.stampNow(),
    waiting: false,
    waitingUntil: '',
    tasks: [
      { id: 1, text: '别的进程投的全局活', status: 'pending', roundSummary: '', createdAt: svc.stampNow(), consumedAt: '' },
    ],
  };
  writeFileSync(storeFile, JSON.stringify(raw, null, 2), 'utf8');

  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'global');
  assert.equal(r.delivered, false); // 轮询路径（非进程内 waiter）
  assert.equal(r.task.text, '别的进程投的全局活');
});

test('全局主题受保护：prune 永不清理（即便空、无 cwd）', async () => {
  await reset();
  await svc.addTask({ global: true, text: '占位' });
  // 领走 → 全局变成「空 + 无 cwd」，正是 prune 的两类清理对象
  await svc.waitForTask({ cwd: dirA, summary: '领全局', open: false });

  const dry = await svc.pruneTopics({ allFinished: true, dryRun: true });
  assert.equal(dry.removed.some((x) => x.key === svc.GLOBAL_KEY), false);
  const r = await svc.pruneTopics({ allFinished: true });
  assert.equal(r.removed.some((x) => x.key === svc.GLOBAL_KEY), false);
  const ov = await svc.listTasks();
  assert.ok(ov.topics.some((t) => t.key === svc.GLOBAL_KEY));
});

test('removeTopic 默认拒绝删全局（--force 才清空）', async () => {
  await reset();
  await svc.addTask({ global: true, text: '别删我' });
  await assert.rejects(
    () => svc.removeTopic({ key: svc.GLOBAL_KEY }),
    (err) => /--force/.test(err.message)
  );
  const r = await svc.removeTopic({ key: svc.GLOBAL_KEY, force: true });
  assert.equal(r.status, 'removed');
  const ov = await svc.listTasks();
  assert.equal(ov.topics.some((t) => t.key === svc.GLOBAL_KEY), false);
});

test('removeTopics --all 跳过全局（reason protected）；force 才连全局一起删', async () => {
  await reset();
  await svc.addTask({ cwd: dirA, text: '本地' });
  await svc.addTask({ global: true, text: '全局' });

  const r1 = await svc.removeTopics({ all: true });
  assert.equal(r1.removed.some((x) => x.key === svc.GLOBAL_KEY), false);
  assert.deepEqual(
    r1.skipped.filter((x) => x.key === svc.GLOBAL_KEY).map((x) => x.reason),
    ['protected']
  );
  let ov = await svc.listTasks();
  assert.ok(ov.topics.some((t) => t.key === svc.GLOBAL_KEY));

  const r2 = await svc.removeTopics({ all: true, force: true });
  assert.equal(r2.removed.some((x) => x.key === svc.GLOBAL_KEY), true);
  ov = await svc.listTasks();
  assert.equal(ov.topics.some((t) => t.key === svc.GLOBAL_KEY), false);
});

test('cancelWait 对全局主题返回 global_not_waitable（全局不是等待源）', async () => {
  await reset();
  const r = await svc.cancelWait({ key: svc.GLOBAL_KEY });
  assert.equal(r.cancelled, false);
  assert.equal(r.reason, 'global_not_waitable');
});

test('全局投递不入等待态：countWaitingTopics 不受影响', async () => {
  await reset();
  await svc.addTask({ global: true, text: '堆积' });
  assert.equal(await svc.countWaitingTopics(), 0);
  const ov = await svc.listTasks();
  assert.equal(ov.waiting, 0);
});

test('任务级 CRUD 按 key 寻址全局主题（get/update/remove）', async () => {
  await reset();
  const a = await svc.addTask({ global: true, text: '第一条' });
  const b = await svc.addTask({ global: true, text: '第二条' });
  assert.equal(a.task.id, 1);
  assert.equal(b.task.id, 2);

  const got = await svc.getTask({ key: svc.GLOBAL_KEY, id: 1 });
  assert.equal(got.text, '第一条');

  const upd = await svc.updateTask({ key: svc.GLOBAL_KEY, id: 1, text: '改过的' });
  assert.equal(upd.task.text, '改过的');

  const rm = await svc.removeTask({ key: svc.GLOBAL_KEY, id: 2 });
  assert.equal(rm.removed.text, '第二条');

  const ov = await svc.listTasks();
  const g = ov.topics.find((t) => t.isGlobal);
  assert.equal(g.total, 1);
});

test('本地 wait 期间投全局、随后本地也被投 → 本地 waiter 优先收本地任务', async () => {
  await reset();
  let fire;
  const ready = new Promise((r) => {
    fire = r;
  });
  const p = svc.waitForTask({ cwd: dirA, summary: '等本地', timeoutSec: 10, open: false, onReady: () => fire() });
  await ready;
  await svc.addTask({ cwd: dirA, text: '本地直投' });
  const r = await p;
  assert.equal(r.source, 'local');
  assert.equal(r.task.text, '本地直投');
});
