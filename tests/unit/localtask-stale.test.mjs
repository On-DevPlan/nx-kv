// 「僵尸等待标志」回归测试。
//
// 事故：gs-ac 的 wait 进程被强杀（SIGKILL / 任务管理器杀 / 终端关掉），
// finally 里的 clearWaiting 没跑，store 里永久残留 waiting:true。
// 后果：
//   - 面板永远显示「等待中 已等 760:35 · 剩 0:00」——它只认裸标志，不看截止
//   - 用户点「关闭」也没用：没有活进程来消费 cancelRequested
//   - 主题永远躲过 prune（空主题也清不掉）、删主题也被"等待中"挡住
//
// 修法：判据统一走 isLiveWaiting——waiting 为真**且**截止时刻还没过。
// 截止已过 = 那个 wait 本来也该收尾了 = 没人真在等。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-stale-'));
const storeFile = join(tmp, 'localtasks.json');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.on('exit', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const key = svc.topicKeyFor('projA');
const cwd = resolve(dirA);

// 往 store 里塞一个「僵尸等待」主题：waiting=true、截止已过 10 小时、无任务。
function writeStaleTopic({ waiting = true, until = '2020-01-01 00:00:00', since = '2019-12-31 23:57:00' } = {}) {
  writeFileSync(
    storeFile,
    JSON.stringify({
      version: 4,
      settings: { timeoutSec: 180, taskSuffix: '' },
      topics: {
        [key]: {
          key,
          cwd,
          name: 'projA',
          summary: '僵尸等待',
          createdAt: since,
          updatedAt: since,
          waiting,
          waitingUntil: until,
          waitingSince: since,
          cancelRequested: true,
          tasks: [],
        },
      },
    }),
    'utf8'
  );
}

test('isLiveWaiting：截止未过才算等待中；已过 / 无时刻 / 未标记都不算', () => {
  const now = Date.now();
  const future = svc.stampNow(new Date(now + 60_000));
  const past = svc.stampNow(new Date(now - 60_000));

  assert.equal(svc.isLiveWaiting({ waiting: true, waitingUntil: future }, now), true);
  assert.equal(svc.isLiveWaiting({ waiting: true, waitingUntil: past }, now), false);
  assert.equal(svc.isLiveWaiting({ waiting: true, waitingUntil: '' }, now), false, '没有截止时刻 = 脏数据');
  assert.equal(svc.isLiveWaiting({ waiting: false, waitingUntil: future }, now), false);
  assert.equal(svc.isLiveWaiting(null, now), false);
});

test('listTasks：僵尸等待 → waiting 抹成 false、staleWaiting 标记为 true，且不计入等待数', async () => {
  writeStaleTopic();
  const ov = await svc.listTasks();
  const t = ov.topics.find((x) => x.key === key);
  assert.equal(t.waiting, false, '对外的 waiting 必须是假值');
  assert.equal(t.staleWaiting, true, '残留事实要单独透出');
  assert.equal(ov.waiting, 0, '总览的等待数不得把僵尸算进去');
});

test('countWaitingTopics：僵尸等待不计入（面板可正常空闲自释放）', async () => {
  writeStaleTopic();
  assert.equal(await svc.countWaitingTopics(), 0);
});

test('pruneTopics：僵尸等待的空主题现在能被清掉（原来永远躲过清理）', async () => {
  writeStaleTopic();
  const dry = await svc.pruneTopics({ dryRun: true });
  assert.equal(dry.count, 1, '应识别为可清理的空主题');
  assert.equal(dry.removed[0].key, key);

  const r = await svc.pruneTopics();
  assert.equal(r.count, 1);
  assert.equal((await svc.listTasks()).topics.length, 0);
});

test('removeTopic：僵尸等待不再挡住删除（不用 --force）', async () => {
  writeStaleTopic();
  const r = await svc.removeTopic({ cwd: dirA });
  assert.equal(r.status, 'removed');
});

test('cancelWait：僵尸等待回 not_waiting（没有活进程可关闭）', async () => {
  writeStaleTopic();
  const r = await svc.cancelWait({ cwd: dirA });
  assert.equal(r.cancelled, false);
  assert.equal(r.reason, 'not_waiting');
});

test('正常等待（截止未过）不受影响：仍算 waiting、仍挡住删除与清理', async () => {
  const future = svc.stampNow(new Date(Date.now() + 120_000));
  writeStaleTopic({ until: future, since: svc.stampNow() });

  const ov = await svc.listTasks();
  const t = ov.topics.find((x) => x.key === key);
  assert.equal(t.waiting, true, '真在等就该是 waiting');
  assert.equal(t.staleWaiting, false);
  assert.equal(ov.waiting, 1);

  assert.equal(await svc.countWaitingTopics(), 1);

  // 删除被挡
  await assert.rejects(() => svc.removeTopic({ cwd: dirA }), /等待中/);
  // prune 也跳过
  assert.equal((await svc.pruneTopics()).count, 0);
});

// ─── 毫秒精度：短时限不再被秒级截断吃掉 ──────────────────────────────
//
// 事故：waitingUntil 存的是 "YYYY-MM-DD HH:mm:ss"，而 stampNow 是**截断**不是四舍五入。
// 真实 deadline = S+1.97s → 存成 "S+1" → 解析回来 S+1.000，比真实时刻早了近 1 秒。
// 短时限（秒级）时这点误差能吃掉**整个**窗口：wait 若在某秒最后 40ms 启动，
// 事件流在 100ms 后轮询时判定「不在等待」→ 永远推不出 waiting 事件
// （tests/unit/localtask-sse.test.mjs 曾因此有 ~4% 的 flake）。
//
// 修法：额外存毫秒精度的 waitingUntilMs，判据一律走 deadlineMsOf()。

test('回归：秒级字符串看着已过期、但毫秒值仍在未来 → 仍算等待中', () => {
  const t = {
    waiting: true,
    waitingUntil: svc.stampNow(new Date(Date.now() - 100)), // 字符串看着已过
    waitingUntilMs: Date.now() + 900, // 精确值还在未来
  };
  assert.equal(svc.isLiveWaiting(t), true, '必须以毫秒值为准');
});

test('回归：毫秒值也过期了 → 不算等待中', () => {
  const t = {
    waiting: true,
    waitingUntil: svc.stampNow(new Date(Date.now() - 100)),
    waitingUntilMs: Date.now() - 50,
  };
  assert.equal(svc.isLiveWaiting(t), false);
});

test('老数据没有 waitingUntilMs 时回退解析字符串（向后兼容）', () => {
  const future = svc.stampNow(new Date(Date.now() + 60_000));
  assert.equal(svc.isLiveWaiting({ waiting: true, waitingUntil: future }), true);
  const past = svc.stampNow(new Date(Date.now() - 60_000));
  assert.equal(svc.isLiveWaiting({ waiting: true, waitingUntil: past }), false);
});

test('真实 wait 会写入毫秒精度的截止时刻', async () => {
  try { rmSync(storeFile); } catch { /* 不存在即可 */ }
  const dirC = mkdirSync(join(tmp, 'projC'), { recursive: true }) || join(tmp, 'projC');
  const p = svc.waitForTask({ cwd: dirC, summary: 's', timeoutSec: 3, open: false });
  await new Promise((r) => setTimeout(r, 150));

  const raw = JSON.parse(readFileSync(storeFile, 'utf8'));
  const t = raw.topics[svc.topicKeyFor('projC')];
  assert.ok(t.waitingUntilMs > 0, '应写入 waitingUntilMs');
  assert.equal(svc.isLiveWaiting(t), true);

  // 字符串与毫秒值应指向同一秒（字符串是给人看的，允许秒级截断）
  const fromStr = new Date(
    +t.waitingUntil.slice(0, 4),
    +t.waitingUntil.slice(5, 7) - 1,
    +t.waitingUntil.slice(8, 10),
    +t.waitingUntil.slice(11, 13),
    +t.waitingUntil.slice(14, 16),
    +t.waitingUntil.slice(17, 19)
  ).getTime();
  assert.ok(Math.abs(t.waitingUntilMs - fromStr) < 1000, '两者应指向同一秒');

  await p.catch(() => {});
});

