// 实时任务输入（localtask）核心逻辑测试：工作目录作为主题、主题拥有任务队列、
// 排队/消费、不同目录分散、同目录不同现状共用队列、超时、内嵌弹窗实时回填与跨进程轮询兜底。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-localtask-'));
const storeFile = join(tmp, 'localtasks.json');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;

async function reset() {
  try {
    rmSync(storeFile);
  } catch {
    /* 不存在即可 */
  }
  // 关掉收尾追加语，保持 task.text 的精确相等断言
  await svc.updateSettings({ taskSuffix: '' });
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

  const res = await fetch(info.addr + 'api/localtasks', {
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
  const { renderPopupPage } = await import('../../src/modules/localtask/popup.js');
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
  const file = process.env.NX_KV_LOCALTASK_STORE;
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

test('reorder：拖拽调整待领取优先级，已领取历史不动', async () => {
  await reset();
  const ids = [];
  for (const text of ['A', 'B', 'C']) ids.push((await svc.addTask({ cwd: dirA, text })).task.id);
  const [a, b, c] = ids;
  const pendingIds = (topic) => topic.tasks.filter((t) => t.status !== 'consumed').map((t) => t.id);

  // A 移到 C 之后 → B,C,A
  let r = await svc.reorderTasks({ cwd: dirA, id: a, afterId: c });
  assert.deepEqual(pendingIds(r.topic), [b, c, a]);

  // C 移到 B 之前 → C,B,A
  r = await svc.reorderTasks({ cwd: dirA, id: c, beforeId: b });
  assert.deepEqual(pendingIds(r.topic), [c, b, a]);

  // 领取第一条（C）→ 已领取固定；再把 B 移到 A 之后，C 仍是数组首项
  const consumed = await svc.consumeFirstPending(r.topic.key, '本轮');
  assert.equal(consumed.id, c);
  r = await svc.reorderTasks({ cwd: dirA, id: b, afterId: a });
  assert.deepEqual(r.topic.tasks.map((t) => t.id), [c, a, b], '已领取 C 固定在首项');
  assert.deepEqual(pendingIds(r.topic), [a, b]);

  // 非法：同时 before+after / 都不给 / 移到自己 / 移动已领取
  await assert.rejects(() => svc.reorderTasks({ cwd: dirA, id: a, beforeId: b, afterId: c }), /--before/);
  await assert.rejects(() => svc.reorderTasks({ cwd: dirA, id: a }), /--before/);
  await assert.rejects(() => svc.reorderTasks({ cwd: dirA, id: a, beforeId: a }), /自己/);
  await assert.rejects(() => svc.reorderTasks({ cwd: dirA, id: c, beforeId: a }), /待领取/);
});

test('删除主题：按 cwd/key 删除整个主题，等待中受保护、force 强删', async () => {
  await reset();
  const a = await svc.addTask({ cwd: dirA, text: 'A1' });
  await svc.addTask({ cwd: dirB, text: 'B1' });

  // 缺定位 / 不存在
  await assert.rejects(() => svc.removeTopic({}), /--cwd/);
  await assert.rejects(() => svc.removeTopic({ key: 'nope' }), /不存在/);

  // 按 cwd 删除 A（连同任务）
  const r = await svc.removeTopic({ cwd: dirA });
  assert.equal(r.status, 'removed');
  assert.equal(r.topic.total, 1);
  const ov = await svc.listTasks();
  assert.equal(ov.topics.length, 1);
  assert.notEqual(ov.topics[0].key, a.key); // 剩 B

  // 等待中默认拒绝：先取走 dirB 的排队任务（队列排空），再 wait 才会阻塞
  const drain = await svc.waitForTask({ cwd: dirB, summary: 'drain', open: false });
  assert.equal(drain.queued, true);
  let info;
  const p = svc.waitForTask({
    cwd: dirB, summary: 'w', timeoutSec: 5, open: false,
    onReady: (h) => { info = h; },
  });
  await new Promise((x) => setTimeout(x, 60));
  await assert.rejects(() => svc.removeTopic({ cwd: dirB }), /等待中/);
  // force 强删
  const rf = await svc.removeTopic({ key: info.key, force: true });
  assert.equal(rf.status, 'removed');
  await p; // wait 随后超时收尾
  assert.equal((await svc.listTasks()).topics.length, 0);
});

test('批量删除：keys/cwds/all，等待中跳过，force 连等待中删', async () => {
  await reset();
  const a = await svc.addTask({ cwd: dirA, text: 'A' });
  const b = await svc.addTask({ cwd: dirB, text: 'B' });

  // 缺条件
  await assert.rejects(() => svc.removeTopics({}), /--keys/);

  // keys 批量删两个
  let r = await svc.removeTopics({ keys: [a.key, b.key] });
  assert.equal(r.count, 2);
  assert.equal((await svc.listTasks()).topics.length, 0);

  // cwds：A 可删，B 等待中 → 跳过
  await svc.addTask({ cwd: dirA, text: 'A2' });
  const p = svc.waitForTask({
    cwd: dirB, summary: 'w', timeoutSec: 5, open: false,
    onReady: () => {},
  });
  await new Promise((x) => setTimeout(x, 60));
  r = await svc.removeTopics({ cwds: [dirA, dirB] });
  assert.equal(r.count, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].reason, 'waiting');

  // all + force：删掉等待中的 B
  r = await svc.removeTopics({ all: true, force: true });
  assert.equal(r.count, 1);
  await p;
  assert.equal((await svc.listTasks()).topics.length, 0);
});

// ─── 收尾追加语（taskSuffix）单测 ─────────────────────────────────────

test('收尾追加语：缺省→默认；空串→关闭；trim；超长截断', async () => {
  assert.equal(svc.clampTaskSuffix(undefined), svc.DEFAULT_TASK_SUFFIX);
  assert.equal(svc.clampTaskSuffix(null), svc.DEFAULT_TASK_SUFFIX);
  assert.equal(svc.clampTaskSuffix(''), '', '空串 = 关闭');
  assert.equal(svc.clampTaskSuffix('  abc  '), 'abc', 'trim');
  assert.equal(svc.clampTaskSuffix('x'.repeat(1000)).length, 500, '超长截断到 500');
});

test('收尾追加语设置：超时与追加语都不传时报错（避免空更新静默成功）', async () => {
  await reset();
  await assert.rejects(() => svc.updateSettings({}), /--timeout/);
});

test('wait 取任务时把收尾追加语拼到返回末尾，但不改库存原文；关闭后不追加', async () => {
  await reset();
  await svc.updateSettings({ taskSuffix: 'TAIL_A' });
  const added = await svc.addTask({ cwd: dirA, text: 'BODY' });
  // 排队直达路径
  const r1 = await svc.waitForTask({ cwd: dirA, summary: 's', open: false });
  assert.equal(r1.status, 'ok');
  assert.equal(r1.queued, true);
  assert.ok(r1.task.text.endsWith('TAIL_A'), '排队路径也拼追加语');
  // 库存原文未被改写
  const list = await svc.listTasks();
  const t1 = list.topics[0].tasks.find((x) => x.id === added.task.id);
  assert.equal(t1.text, 'BODY');

  // 关闭后再来一条，确认不再追加
  await svc.updateSettings({ taskSuffix: '' });
  const added2 = await svc.addTask({ cwd: dirA, text: 'BODY2' });
  const r2 = await svc.waitForTask({ cwd: dirA, summary: 's2', open: false });
  assert.equal(r2.task.text, 'BODY2', '关闭后 task.text 保持原样');
});

test('收尾追加语设置：默认值/自定义/清空关闭/恢复默认/改超时不覆盖追加语', async () => {
  await reset();
  // reset 后 settings.taskSuffix = ''（关闭）；getSettings 暴露的 defaultTaskSuffix 永远在
  const s0 = await svc.getSettings();
  assert.equal(s0.taskSuffix, '');
  assert.equal(s0.suffixEnabled, false);
  assert.ok(s0.defaultTaskSuffix && s0.defaultTaskSuffix.length > 0, '默认文案必须非空');

  // 改超时不动追加语
  const s1 = await svc.updateSettings({ timeoutSec: 300 });
  assert.equal(s1.timeoutSec, 300);
  assert.equal(s1.taskSuffix, '', '改超时不覆盖关闭状态');

  // 设为自定义
  const s2 = await svc.updateSettings({ taskSuffix: 'MY_TAIL' });
  assert.equal(s2.taskSuffix, 'MY_TAIL');
  assert.equal(s2.suffixEnabled, true);

  // 改超时仍不动
  const s3 = await svc.updateSettings({ timeoutSec: 60 });
  assert.equal(s3.timeoutSec, 60);
  assert.equal(s3.taskSuffix, 'MY_TAIL');

  // 恢复默认（调用方应传 DEFAULT_TASK_SUFFIX）
  const s4 = await svc.updateSettings({ taskSuffix: svc.DEFAULT_TASK_SUFFIX });
  assert.equal(s4.taskSuffix, svc.DEFAULT_TASK_SUFFIX);
  assert.equal(s4.suffixEnabled, true);

  // 清空关闭
  const s5 = await svc.updateSettings({ taskSuffix: '' });
  assert.equal(s5.taskSuffix, '');
  assert.equal(s5.suffixEnabled, false);
});

test('收尾追加语幂等：任务原文已包含同样追加语时不重复追加', async () => {
  await reset();
  const tail = 'IDEMPOTENT_TAIL';
  await svc.updateSettings({ taskSuffix: tail });
  // 先构造一条「任务原文里已含 tail」的 pending：addTask → 改文本（绕过 UI 限制）
  const added = await svc.addTask({ cwd: dirA, text: 'INNER' });
  await svc.updateTask({ cwd: dirA, id: added.task.id, text: 'INNER\n\n' + tail });
  const r = await svc.waitForTask({ cwd: dirA, summary: 's', open: false });
  // 原文已含 tail，不应重复拼
  assert.ok(r.task && r.task.text.includes(tail), JSON.stringify(r));
  assert.ok(!r.task.text.includes(tail + '\n\n' + tail) && !r.task.text.includes(tail + tail), '不应该出现重复追加');
});
