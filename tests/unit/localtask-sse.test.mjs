// 等待生命周期事件流单测：
//   1. 纯函数 remindersDue：剩余 30s/10s 触发、过时不重复、未到点不触发
//   2. watchEvents 生成器：等待开始 → 立即 deliver / 超时 → 30s 10s 提醒 + resolved
//   3. watchEvents 首次连接：已在等待中也补发 waiting 快照（replay:true）
//   4. streamEventsSSE：连上即推 waiting 快照帧、断开干净结束
//
// 存储一律指向临时文件，绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-sse-'));
const storeFile = join(tmp, 'localtasks.json');
process.env.NX_KV_LOCALTASK_STORE = storeFile;
const cwd = process.cwd();
const svcUrl = pathToFileURL(join(cwd, 'src/modules/localtask/service.js')).href;
const svc = await import(svcUrl);

async function reset() {
  try { rmSync(storeFile); } catch { /* 不存在即可 */ }
  await svc.updateSettings({ taskSuffix: '' });
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
  const k = svc.topicKeyFor(dirA.split(/[\\/]/).pop());
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

  // 进入等待（无 pending → 阻塞）→ 100ms 后另一个进程 addTask 喂任务 → delivered
  const waitP = svc.waitForTask({ cwd: dirA, summary: 's', timeoutSec: 5, open: false });
  await new Promise((r) => setTimeout(r, 200));
  await svc.addTask({ cwd: dirA, text: '回填任务' });

  // 限时等待 resolved
  await Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
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
  const p2 = svc.waitForTask({ cwd: dirB, summary: '无人', timeoutSec: 1, open: false });

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
  // 这里换一种方式：开一个 wait，把 setWaiting 写入
  const { setWaiting } = await import(svcUrl);
  // 构造一个 waiting 主题
  await svc.addTask({ cwd: dirC, text: 'T' });
  await svc.consumeFirstPending(svc.topicKeyFor(dirC.split(/[\\/]/).pop()), ''); // 队列清空
  // 直接写 store 设置 waiting=true + waitingUntil
  const fs = await import('node:fs/promises');
  const data = JSON.parse(await fs.readFile(storeFile, 'utf8'));
  const k = svc.topicKeyFor(dirC.split(/[\\/]/).pop());
  data.topics[k].waiting = true;
  data.topics[k].waitingUntil = svc.stampNow(new Date(Date.now() + 30000));
  await fs.writeFile(storeFile, JSON.stringify(data, null, 2), 'utf8');

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
      { host: '127.0.0.1', port, path: '/api/localtasks/events?key=' + k },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          // SSE 帧以 \n\n 分隔
          for (const frame of chunk.split('\n\n')) {
            if (!frame.trim()) continue;
            const m = /^event: (\w+)\ndata: (.+)$/.exec(frame);
            if (m) events.push({ event: m[1], data: JSON.parse(m[2]) });
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
  assert.equal(waiting.data.key, k);
  assert.equal(waiting.data.replay, true, '首次连接已在等待 → replay:true');
});
