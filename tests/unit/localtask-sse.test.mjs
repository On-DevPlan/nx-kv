// 等待生命周期事件流单测：
//   1. 纯函数 remindersDue：剩余 30s/10s 触发、过时不重复、未到点不触发
//   2. watchEvents 生成器：等待开始 → 立即 deliver / 超时 → 30s 10s 提醒 + resolved
//   3. watchEvents 首次连接：已在等待中也补发 waiting 快照（replay:true）
//   4. streamEventsSSE：连上即推 waiting 快照帧、断开干净结束
//
// 存储一律指向临时文件，绝不写脏用户目录。
import { test } from 'node:test';
import { waitForTask } from '../../src/modules/tasktool/wait.js';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-sse-'));
const storeFile = join(tmp, 'localtasks.json');
process.env.NX_KV_DB = join(tmp, 'nxkv.db'); // 显式钉库：防止外部 NX_KV_DB 覆盖隔离
process.env.NX_KV_LOCALTASK_STORE = storeFile;
const cwd = process.cwd();
const svcUrl = pathToFileURL(join(cwd, 'src/modules/localtask/service.js')).href;
const svc = await import(svcUrl);

async function reset() {
  try { svc.resetLocaltaskStore(); } catch { /* 不存在即可 */ }
}

test('remindersDue：剩余 30s/10s 各触发一次，过后不重复', () => {
  // 30s
  assert.deepEqual(svc.remindersDue(30, new Set()), [30]);
  assert.deepEqual(svc.remindersDue(29, new Set()), [30]);
  // 30s 已触发 → 不再出
  assert.deepEqual(svc.remindersDue(30, new Set([30])), []);
  // 10s
  assert.deepEqual(svc.remindersDue(10, new Set([30])), [10]);
  assert.deepEqual(svc.remindersDue(10, new Set([30, 10])), []);
  // 0 临界：不触发（>0 条件）
  assert.deepEqual(svc.remindersDue(0, new Set()), []);
  // 负数：不触发
  assert.deepEqual(svc.remindersDue(-1, new Set()), []);
  // 31s：不在任何阈值内
  assert.deepEqual(svc.remindersDue(31, new Set()), []);
});

test('watchEvents：等待开始 → 立即 deliver（delivered）', async () => {
  await reset();
  const dirA = join(tmp, 'projA');
  const ac = new AbortController();
  const evs = [];
  const p = (async () => {
    for await (const ev of svc.watchEvents({ cwd: dirA, pollMs: 100, signal: ac.signal })) {
      evs.push(ev);
      if (ev.type === 'resolved') {
        ac.abort();
        return;
      }
    }
  })();

  // 进入等待（无 pending → 阻塞）→ 等 waiting 事件真的出现 → addTask 喂任务 → delivered
  //
  // 两处不能写死：
  //   ① 喂任务前要**等 waiting 快照出现**（固定睡 200ms 在满载时不够——waitForTask
  //      的准备超过 200ms 时，任务先落地 → 等待直接被回填 → 永远看不到 waiting 事件）；
  //   ② 等待预算给宽（30s）：机器满载时 5s 预算会先到期 → outcome 变 timeout → 偶发红。
  //      正常路径不等预算（任务一喂到就 resolve），加预算不影响耗时。
  const waitP = waitForTask({ cwd: dirA, summary: 's', timeoutSec: 30, open: false });
  const seenAt = Date.now();
  while (!evs.some((e) => e.type === 'waiting') && Date.now() - seenAt < 15000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await svc.addTask({ cwd: dirA, text: '回填任务' });

  // 限时等待 resolved
  await Promise.race([p, new Promise((r) => setTimeout(r, 30000))]);
  ac.abort();
  await p.catch(() => {});
  const w = await waitP.catch(() => ({}));

  const types = evs.map((e) => e.type);
  assert.ok(types.includes('waiting'), '应推 waiting 事件，got: ' + JSON.stringify(evs));
  assert.ok(types.includes('resolved'), '应推 resolved 事件');
  const resolved = evs.find((e) => e.type === 'resolved');
  assert.equal(resolved.outcome, 'delivered', '任务被回填 → delivered');
  assert.equal(w.status, 'ok');
  assert.equal(w.task.text, '回填任务');
});

test('watchEvents：无人回填到点 → resolved(timeout)', async () => {
  await reset();
  const dirB = join(tmp, 'projB');
  const ac = new AbortController();
  const evs = [];
  const p = (async () => {
    for await (const ev of svc.watchEvents({ cwd: dirB, pollMs: 100, signal: ac.signal })) {
      evs.push(ev);
      if (ev.type === 'resolved' && !ev.stale) {
        ac.abort();
        return;
      }
    }
  })();
  await new Promise((r) => setTimeout(r, 60));
  const p2 = waitForTask({ cwd: dirB, summary: '无人', timeoutSec: 1, open: false });

  await Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
  ac.abort();
  await p.catch(() => {});
  await p2.catch(() => {});

  const types = evs.map((e) => e.type);
  assert.ok(types.includes('waiting'), '应推 waiting');
  const resolved = evs.find((e) => e.type === 'resolved' && !e.stale);
  assert.ok(resolved, '应推非 stale resolved');
  assert.equal(resolved.outcome, 'timeout');
});

test('streamEventsSSE：连接即推 waiting 快照帧，断开干净结束', async () => {
  await reset();
  const dirC = join(tmp, 'projC');
  // 写一个 waiting 状态（不实际开 wait）—— 直接调 setWaiting
  // 由于 setWaiting 是 file-local，我们用 addTask+wait 启动一条等待
  // 这里换一种方式：开一个 wait，把 store 写入
  // 构造一个 waiting 主题
  await svc.addTask({ cwd: dirC, text: 'T' });
  await svc.consumeFirstPending(svc.topicKeyFor(dirC), ''); // 队列清空（key 由完整 cwd 派生）
  // 直接写库设置 waiting=true + waitingUntil（presence 表）
  svc.repo.presence.setPresence(svc.topicKeyFor(dirC), {
    waiting: true,
    untilMs: Date.now() + 30_000,
    sinceMs: Date.now(),
    cancelRequested: false,
  });

  // 起一个临时 server 跑 streamEventsSSE
  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/localtasks/events')) {
      const u = new URL(req.url, 'http://localhost');
      svc.streamEventsSSE(req, res, { key: u.searchParams.get('key') || undefined }).catch(() => {});
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const got = await new Promise((resolve_) => {
    const events = [];
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/localtasks/events?key=' + svc.topicKeyFor(dirC) },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          // SSE 帧以 \n\n 分隔；事件帧前面可能带 id:（重连续传用）
          for (const frame of chunk.split('\n\n')) {
            if (!frame.trim()) continue;
            const m = /^(?:id: (\d+)\n)?event: (\w+)\ndata: (.+)$/.exec(frame);
            if (m) events.push({ id: m[1], event: m[2], data: JSON.parse(m[3]) });
          }
          if (events.some((e) => e.event === 'waiting')) {
            req.destroy();
            resolve_(events);
          }
        });
        res.on('end', () => resolve_(events));
      }
    );
    req.on('error', () => resolve_(events));
    setTimeout(() => { req.destroy(); resolve_(events); }, 3000);
  });

  await new Promise((r) => server.close(r));

  const waiting = got.find((e) => e.event === 'waiting');
  assert.ok(waiting, '应收到 waiting 事件');
  assert.equal(waiting.data.key, svc.topicKeyFor(dirC));
  assert.equal(waiting.data.replay, true, '首次连接已在等待 → replay:true');
  assert.ok(waiting.id, '事件帧应带单调 id（浏览器重连可据此续传）');
});
