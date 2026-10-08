// 实时任务输入（sessiontask）核心逻辑测试：现状总结作为等待点 key、排队/消费、
// 不同现状分散、相同现状复用、超时、内嵌弹窗实时回填与跨进程轮询兜底。
//
// 存储一律指向临时文件（NX_KV_SESSIONTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/sessiontask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-sessiontask-'));
const storeFile = join(tmp, 'sessiontasks.json');
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
  assert.deepEqual(d.slots, []);
});

test('wait 阻塞 → 弹窗 HTML 含现状 → POST 实时回填唤醒', async () => {
  await reset();
  let info;
  const summary = '已完成登录，等待选择工作空间';
  const p = svc.waitForTask({
    summary,
    timeoutMs: 3000,
    open: false,
    onReady: (h) => {
      info = h;
    },
  });
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(info.summary, summary);
  assert.ok(info.key);
  const html = await (await fetch(info.addr)).text();
  assert.ok(html.includes('nx-kv'));
  assert.ok(html.includes('当前现状'));
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
  assert.equal(r.summary, summary);
  assert.equal(r.task.text, '选择工作空间 A');

  const d = await svc.listTasks();
  assert.equal(d.waiting, 0);
  assert.equal(d.slots[0].waiting, false);
});

test('add 排队 → wait 立即取走（queued，不开窗）', async () => {
  await reset();
  const summary = '现状A';
  await svc.addTask({ summary, text: '提前排的' });
  const r = await svc.waitForTask({ summary, open: false });
  assert.equal(r.status, 'ok');
  assert.equal(r.queued, true);
  assert.equal(r.task.text, '提前排的');
});

test('不同现状分散为不同等待点，各自回填互不串', async () => {
  await reset();
  const a = await svc.addTask({ summary: '现状A', text: 'A 的答复' });
  const b = await svc.addTask({ summary: '现状B', text: 'B 的答复' });
  assert.notEqual(a.key, b.key);

  const ov = await svc.listTasks();
  assert.equal(ov.slots.length, 2);

  const ra = await svc.waitForTask({ summary: '现状A', open: false });
  assert.equal(ra.task.text, 'A 的答复');
  const rb = await svc.waitForTask({ summary: '现状B', open: false });
  assert.equal(rb.task.text, 'B 的答复');
});

test('相同现状（忽略首尾/连续空白差异）→ 同一 key', async () => {
  const k1 = svc.keyForSummary(svc.normalizeSummary('现状  A'));
  const k2 = svc.keyForSummary(svc.normalizeSummary('现状 A '));
  const k3 = svc.keyForSummary(svc.normalizeSummary('现状 A'));
  assert.equal(k1, k2);
  assert.equal(k2, k3);
});

test('wait 超时 → status timeout（业务结果，不抛错）', async () => {
  await reset();
  const t0 = Date.now();
  const r = await svc.waitForTask({ summary: '现状T', timeoutMs: 250, open: false });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 'timeout');
  assert.ok(elapsed >= 240 && elapsed < 900, 'elapsed=' + elapsed);
});

test('跨进程兜底：外部写入该 slot 的 pending，轮询取走', async () => {
  await reset();
  let info;
  const summary = '现状X';
  const p = svc.waitForTask({
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
      version: 2,
      slots: {
        [info.key]: {
          key: info.key,
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
  const summary = '现状C';
  const a = await svc.addTask({ summary, text: '原文' });
  const u = await svc.updateTask({ summary, id: a.task.id, text: '改后' });
  assert.equal(u.task.text, '改后');
  assert.equal((await svc.getTask({ summary, id: a.task.id })).text, '改后');
  const removed = await svc.removeTask({ summary, id: a.task.id });
  assert.equal(removed.removed.id, a.task.id);
  assert.equal((await svc.listTasks()).slots[0].total, 0);
});

test('缺 summary / 空内容 / 缺 id 报错，不建空记录', async () => {
  await reset();
  await assert.rejects(() => svc.waitForTask({ summary: '  ' }), /--summary/);
  await assert.rejects(() => svc.addTask({ summary: '现状A', text: '  ' }), /不能为空/);
  await assert.rejects(() => svc.getTask({ summary: '现状A' }), /--id/);
});
