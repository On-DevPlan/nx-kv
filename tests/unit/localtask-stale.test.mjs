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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
