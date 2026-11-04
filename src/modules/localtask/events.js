// （#54 自 service.js 拆出）等待生命周期事件流：轮询 store，从 waiting/waitingUntil 与
// 已领取数的变化里派生 waiting/reminder/resolved 事件；SSE（streamEventsSSE）与
// CLI（NDJSON）共用 watchEvents 生成器。
import { isGlobalKey, normalizeCwd } from './paths.js';
import { loadStore } from './store-io.js';
import { deadlineMsOf } from './task-view.js';
import { addEventStreamConn } from './panel-presence.js';
// ─── 等待生命周期事件流（主面板及时通知，避免用户漏过超时）────────────
//
// wait 与常驻主面板通常是两个进程，内存 EventEmitter 跨不过进程，所以事件流
// 不依赖进程内回调，而是轮询 store，从 waiting/waitingUntil 与「已领取数」的变化里
// 派生事件：waiting / reminder（剩余 30s、10s）/ resolved（delivered 或 timeout）。
// HTTP(SSE) 与 CLI(NDJSON) 共用本生成器。

const EVENT_POLL_MS = 500;
const REMINDER_SEC = [30, 10]; // 剩余 ≤30s、≤10s 各提醒一次

// 纯函数：给定剩余秒数与已提醒过的阈值，返回本次应触发的阈值（秒）。便于单测。
export function remindersDue(remainSec, firedSet) {
  const out = [];
  for (const sec of REMINDER_SEC) {
    if (remainSec <= sec && remainSec > 0 && !firedSet.has(sec)) out.push(sec);
  }
  return out;
}

function consumedCount(t) {
  return (Array.isArray(t.tasks) ? t.tasks : []).filter((x) => x.status === 'consumed').length;
}

/**
 * 订阅等待生命周期事件（异步生成器）。
 * @param {{cwd?:string,key?:string,pollMs?:number,signal?:AbortSignal}} opts
 *   不传 cwd/key 则订阅全部主题（主面板总览需要）。
 */
export async function* watchEvents({ cwd: rawCwd, key: rawKey, pollMs = EVENT_POLL_MS, signal } = {}) {
  let onlyKey = null;
  if (rawKey && String(rawKey).trim()) onlyKey = String(rawKey).trim();
  else if (rawCwd && String(rawCwd).trim()) onlyKey = normalizeCwd(rawCwd).key;

  const sleep = (ms) =>
    new Promise((res) => {
      const to = setTimeout(res, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(to);
            res();
          },
          { once: true }
        );
      }
    });

  const state = new Map();
  let first = true;
  while (!(signal && signal.aborted)) {
    let topics = [];
    try {
      const store = await loadStore();
      topics = Object.values(store.topics).filter(
        (t) => Array.isArray(t.tasks) && (!onlyKey || t.key === onlyKey)
      );
    } catch {
      topics = [];
    }

    const now = Date.now();
    for (const t of topics) {
      // 截止时刻走 deadlineMsOf()：优先毫秒精度的 waitingUntilMs，老数据才解析字符串。
      // 之前这里自己解析 waitingUntil（秒级），短时限下截断误差会让「正在等」被判成
      // 「没在等」→ 事件流永远推不出 waiting（tests/unit/localtask-sse.test.mjs 曾
      // 因此有 ~4% 的 flake）。
      const deadline = deadlineMsOf(t);
      const isWaiting = !!t.waiting && Number.isFinite(deadline) && deadline > now;
      let st = state.get(t.key);

      if (isWaiting) {
        // 「是不是新一轮等待」用**毫秒精度的 deadline** 判定：waitingUntil 字符串只有
        // 秒级，同一秒内开始的两次等待字符串相同，靠它判会漏掉新一轮。
        if (!st || st.phase !== 'waiting' || st.deadline !== deadline) {
          st = {
            phase: 'waiting',
            waitingUntil: t.waitingUntil,
            deadline,
            consumed0: consumedCount(t),
            reminders: new Set(),
          };
          state.set(t.key, st);
          yield {
            type: 'waiting',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            summary: t.summary || '',
            isGlobal: isGlobalKey(t.key),
            waitingUntil: t.waitingUntil,
            remainMs: Math.max(0, deadline - now),
            replay: first,
          };
        }
        const remainSec = Math.floor((st.deadline - now) / 1000);
        for (const sec of remindersDue(remainSec, st.reminders)) {
          st.reminders.add(sec);
          yield {
            type: 'reminder',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            summary: t.summary || '',
            isGlobal: isGlobalKey(t.key),
            waitingUntil: t.waitingUntil,
            remainSec: sec,
            remainMs: Math.max(0, st.deadline - now),
            label: `${sec}s`,
          };
        }
      } else if (st && st.phase === 'waiting') {
        const outcome = consumedCount(t) > st.consumed0 ? 'delivered' : 'timeout';
        state.set(t.key, { phase: 'ended' });
        yield { type: 'resolved', key: t.key, cwd: t.cwd || '', name: t.name || '', isGlobal: isGlobalKey(t.key), outcome };
      } else if (!st) {
        state.set(t.key, { phase: 'idle' });
      }

      // 兜底：waiting 标志还在但截止已过（wait 进程异常退出），也派生一次 timeout
      if (t.waiting && (!Number.isFinite(deadline) || deadline <= now)) {
        const cur = state.get(t.key);
        if (!cur || cur.phase === 'waiting') {
          state.set(t.key, { phase: 'ended' });
          yield {
            type: 'resolved',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            isGlobal: isGlobalKey(t.key),
            outcome: 'timeout',
            stale: true,
          };
        }
      }
    }

    first = false;
    await sleep(pollMs);
  }
}

// HTTP 传输：SSE。注册到 sseConns 让 panelPresence 计入（wait 据此判活标签）。
// 客户端断开即中止生成器。SSE 心跳由 addEventStreamConn 统一管。
export async function streamEventsSSE(req, res, { cwd, key } = {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // 断线重连提示（浏览器 EventSource 默认 3s 重连，这里写明确一点）。
    // 对齐 opencode 的 SSE 加固做法（event.ts:21-28）。
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(': connected\n\n');
  // addEventStreamConn 内部已把 conn 加入 sseConns（panelPresence 据此统计活标签），
  // 我们不再直接引用——心跳 / 失败剔除 / 断开清理都由它托管。
  addEventStreamConn(req, res);
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  let seq = 0;
  try {
    for await (const ev of watchEvents({ cwd, key, signal: ac.signal })) {
      // 单调 id：浏览器重连后可带着 Last-Event-ID 回来（这里只保证不重复，
      // 事件本身是从 store 派生的，重放也不会串）。
      seq += 1;
      res.write(`id: ${seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  } catch {
    /* 客户端断开 / 瞬时读盘错误，静默结束 */
  }
}

// CLI 传输：**逐行 NDJSON**（一行一个事件），与 HTTP 的 SSE 同源（都用 watchEvents）。
//
// 以前 CLI 跑 `localtask events` 必崩：那条 action 原本只做 SSE，
// 直接摸 `ctx.__raw.req` —— 而 `__raw` 只在 HTTP 传输下才注入，CLI 进程里是 undefined。
// 现在按传输方式分流，CLI 这条命令真能用（CHANGELOG 当初承诺的「CLI 等价逐行 NDJSON」）。
//
// 它是**长连**：命令会一直打印到用户 Ctrl+C（stdout 被关闭即结束）。
export async function streamEventsNDJSON({ cwd, key, signal, timeoutSec, limit } = {}) {
  const ac = new AbortController();
  // agent 需要能**给这条长连划个边界**：gh run watch 有 --exit-status / --interval，
  // 这里给 --timeout（最长监听多少秒）与 --limit（最多几条事件）。都不给就是无限流。
  const timer =
    Number.isFinite(timeoutSec) && timeoutSec > 0 ? setTimeout(() => ac.abort(), timeoutSec * 1000) : null;
  let n = 0;
  try {
    for await (const ev of watchEvents({ cwd, key, signal: signal || ac.signal })) {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
      n += 1;
      if (Number.isFinite(limit) && limit > 0 && n >= limit) break;
    }
  } catch {
    /* Ctrl+C / 管道断开：静默收尾 */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

