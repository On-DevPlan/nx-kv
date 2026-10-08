// 实时任务输入（sessiontask）核心逻辑测试：工作目录作为主题、主题拥有任务队列、
// 排队/消费、不同目录分散、同目录不同现状共用队列、超时、内嵌弹窗实时回填与跨进程轮询兜底。
//
// 存储一律指向临时文件（NX_KV_SESSIONTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import * as svc from '../../src/modules/sessiontask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-sessiontask-'));
const storeFile = join(tmp, 'sessiontasks.json');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_SESSIONTASK_STORE = storeFile;

async function reset() {
  try {
    rmSync(storeFile);
  } catch {
    /* 不存在即可 */
  }
}

test('空总览', async () => {
  await reset();
  const d = await svc.listTasks();
  assert.equal(d.waiting, 0);
  assert.deepEqual(d.topics, []);
});

test('wait 阻塞 → 弹窗 HTML 含主题与现状 → POST 实时回填唤醒', async () => {
  await reset();
  let info;
  const summary = '已完成登录，等待选择工作空间';
  const p = svc.waitForTask({
    cwd: dirA,
    summary,
    timeoutMs: 3000,
    open: false,
    onReady: (h) => {
      info = h;
    },
  });
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(info.cwd, resolve(dirA));
  assert.ok(info.key);
  const html = await (await fetch(info.addr)).text();
  assert.ok(html.includes('nx-kv'));
  assert.ok(html.includes('主题（工作目录）'));
  assert.ok(html.includes(basename(dirA)));
  assert.ok(html.includes(summary));

  const res = await fetch(info.addr + 'api/sessiontasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '选择工作空间 A' }),
  });
  const j = await res.json();
  assert.ok(j.ok);
  assert.equal(j.data.delivered, true);

  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.delivered, true);
  assert.equal(r.cwd, resolve(dirA));
  assert.equal(r.summary, summary);
  assert.equal(r.task.text, '选择工作空间 A');

  const d = await svc.listTasks();
  assert.equal(d.waiting, 0);
  assert.equal(d.topics[0].waiting, false);
});

test('add 排队 → wait 立即取走（queued，不开窗）', async () => {
  await reset();
  await svc.addTask({ cwd: dirA, text: '提前排的' });
  const r = await svc.waitForTask({ cwd: dirA, summary: '现状A', open: false });
  assert.equal(r.status, 'ok');
  assert.equal(r.queued, true);
  assert.equal(r.task.text, '提前排的');
});

test('不同目录分散为不同主题，各自回填互不串', async () => {
  await reset();
  const a = await svc.addTask({ cwd: dirA, text: 'A 的答复' });
  const b = await svc.addTask({ cwd: dirB, text: 'B 的答复' });
  assert.notEqual(a.key, b.key);

  const ov = await svc.listTasks();
  assert.equal(ov.topics.length, 2);

  const ra = await svc.waitForTask({ cwd: dirA, summary: '现状A', open: false });
  assert.equal(ra.task.text, 'A 的答复');
  const rb = await svc.waitForTask({ cwd: dirB, summary: '现状B', open: false });
  assert.equal(rb.task.text, 'B 的答复');
});

test('同目录不同现状 → 同一主题、共享队列（任务可跨现状堆积领取）', async () => {
  await reset();
  await svc.addTask({ cwd: dirA, summary: '现状A', text: '任务1' });
  // 用不同现状措辞在同一目录 wait，仍应取到队列里的任务1
  const r = await svc.waitForTask({ cwd: dirA, summary: '现状B（措辞不同）', open: false });
  assert.equal(r.queued, true);
  assert.equal(r.task.text, '任务1');
  assert.equal(r.summary, '现状B（措辞不同）');

  const ov = await svc.listTasks();
  assert.equal(ov.topics.length, 1);
});

test('主题 key：按目录名、Windows 折叠大小写', async () => {
  // 同名目录（不同完整路径）→ 同一主题
  const kA1 = svc.normalizeCwd(join(tmp, 'x', 'br_ct')).key;
  const kA2 = svc.normalizeCwd(join(tmp, 'y', 'br_ct')).key;
  assert.equal(kA1, kA2);
  if (process.platform === 'win32') {
    assert.equal(svc.topicKeyFor('Br_Ct'), svc.topicKeyFor('br_ct'));
  }
});

test('wait 超时 → status timeout（业务结果，不抛错）', async () => {
  await reset();
  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dirA, summary: '现状T', timeoutSec: 1, open: false });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 'timeout');
  assert.ok(elapsed >= 900 && elapsed < 1500, 'elapsed=' + elapsed);
});

test('超时设置：默认 180，更新生效，超上限截断为 600；wait 默认采用页面配置', async () => {
  await reset();
  let s = await svc.getSettings();
  assert.equal(s.timeoutSec, 180);
  assert.equal(s.recommendedSec, 180);
  assert.equal(s.maxSec, 600);

  s = await svc.updateSettings({ timeoutSec: 300 });
  assert.equal(s.timeoutSec, 300);
  s = await svc.updateSettings({ timeoutSec: 9999 });
  assert.equal(s.timeoutSec, 600);

  // 页面配置为 1 秒后，wait 不显式给超时 → 约 1 秒超时
  await svc.updateSettings({ timeoutSec: 1 });
  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dirA, summary: 'cfg', open: false });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - t0 < 1500);
});

test('跨进程兜底：外部写入该主题的 pending，轮询取走', async () => {
  await reset();
  let info;
  const summary = '现状X';
  const p = svc.waitForTask({
    cwd: dirA,
    summary,
    timeoutMs: 3000,
    open: false,
    onReady: (h) => {
      info = h;
    },
  });
  await new Promise((r) => setTimeout(r, 60));

  const now = '2026-10-06 10:00:00';
  writeFileSync(
    storeFile,
    JSON.stringify({
      version: 3,
      topics: {
        [info.key]: {
          key: info.key,
          cwd: resolve(dirA),
          name: basename(dirA),
          summary,
          createdAt: now,
          updatedAt: now,
          waiting: true,
          waitingUntil: '2026-10-06 10:02:00',
          tasks: [{ id: 1, text: '别的进程写的', status: 'pending', createdAt: now, consumedAt: '' }],
        },
      },
    }),
    'utf8'
  );

  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.delivered, false); // 走轮询而非内存 waiter
  assert.equal(r.task.text, '别的进程写的');
});

test('update / get / remove 链路', async () => {
  await reset();
  const a = await svc.addTask({ cwd: dirA, text: '原文' });
  const u = await svc.updateTask({ cwd: dirA, id: a.task.id, text: '改后' });
  assert.equal(u.task.text, '改后');
  assert.equal((await svc.getTask({ cwd: dirA, id: a.task.id })).text, '改后');
  const removed = await svc.removeTask({ cwd: dirA, id: a.task.id });
  assert.equal(removed.removed.id, a.task.id);
  assert.equal((await svc.listTasks()).topics[0].total, 0);
});

test('缺 summary / 空内容 / 缺 id 报错，不建空记录', async () => {
  await reset();
  await assert.rejects(() => svc.waitForTask({ cwd: dirA }), /--summary/);
  await assert.rejects(() => svc.addTask({ cwd: dirA, text: '  ' }), /不能为空/);
  await assert.rejects(() => svc.getTask({ cwd: dirA }), /--id/);
});

test('弹窗：agent 领取（delivered）后不再显示倒计时', async () => {
  const { renderPopupPage } = await import('../../src/modules/sessiontask/popup.js');
  const html = renderPopupPage({ key: 'k1', cwd: dirA, summary: '现状', timeoutMs: 180000 });
  // 等待态有倒计时状态条
  assert.ok(html.includes('id="statusbar"'));
  assert.ok(html.includes('id="clock"'));
  // delivered 分支隐藏整个倒计时状态条
  assert.ok(html.includes("el('statusbar').style.display = 'none'"));
  // 计时器在 delivered 后不再更新
  assert.ok(/function tickClock\(\) \{\s*if \(delivered\) return;/.test(html));
});

test('队列任务被领取时记录本轮完成总结（queued 路径）', async () => {
  await reset();
  await svc.addTask({ cwd: dirA, text: '提前排的' });
  const r = await svc.waitForTask({ cwd: dirA, summary: '本轮完成总结Q', open: false });
  assert.equal(r.queued, true);
  assert.equal(r.task.roundSummary, '本轮完成总结Q');
});

test('实时回填记录本轮完成总结（delivered 路径）', async () => {
  await reset();
  const summary = '本轮完成总结D';
  const r = await svc.waitForTask({
    cwd: dirA,
    summary,
    timeoutSec: 5,
    open: false,
    onReady: async () => {
      await svc.addTask({ cwd: dirA, text: '回填' });
    },
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.delivered, true);
  assert.equal(r.task.roundSummary, summary);
});

test('prune 清理旧模型无目录主题与空主题，保留有数据主题', async () => {
  await reset();
  // 正常、有待领任务的主题（保留）
  await svc.addTask({ cwd: dirA, text: '保留我' });
  // 空主题：dirB 上 wait 超时后留下
  await svc.waitForTask({ cwd: dirB, summary: 'x', timeoutSec: 1, open: false });
  // 注入一个旧模型迁移来的「无目录」主题
  const file = process.env.NX_KV_SESSIONTASK_STORE;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.topics.legacytopic = {
    key: 'legacytopic', cwd: '', name: '旧数据', summary: '旧',
    createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
    waiting: false, waitingUntil: '',
    tasks: [{ id: 1, text: '旧', status: 'consumed' }],
  };
  writeFileSync(file, JSON.stringify(raw));

  // dryRun 只报告：空主题 + 无目录主题 = 2
  let r = await svc.pruneTopics({ dryRun: true });
  assert.equal(r.count, 2);
  assert.ok((await svc.listTasks()).topics.length === 3, 'dryRun 不改动');

  r = await svc.pruneTopics();
  assert.equal(r.count, 2);
  const ov = await svc.listTasks();
  assert.equal(ov.topics.length, 1);
  assert.equal(ov.topics[0].cwd, resolve(dirA));
});

test('prune 默认不清理已全部领取的主题，--all-finished 才清', async () => {
  await reset();
  await svc.addTask({ cwd: dirA, text: 't' });
  await svc.waitForTask({ cwd: dirA, summary: 's', open: false }); // 取走 → 0 pending
  assert.equal((await svc.pruneTopics()).count, 0);
  const r = await svc.pruneTopics({ allFinished: true });
  assert.equal(r.count, 1);
});
