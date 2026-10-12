// 常驻面板「空闲自释放」的判定与看门狗测试。
//
// 覆盖三件事：
//   1. 纯判定规则——所有否决条件（非 auto-exit / 有等待 / 有活标签）与宽限期（见过面板
//      用短宽限、从未连过用长宽限）都必须成立才释放；
//   2. 过期 waiting 标志不阻塞释放（wait 进程被强杀后 store 里会残留 waiting:true）；
//   3. 看门狗本身：假时钟 + 假 server 驱动，验证「未到宽限不释放、到了释放一次且只一次、
//      有等待中的主题时即使静默很久也不释放」。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PANEL_IDLE_DEFAULTS,
  shouldAutoExit,
  startPanelIdleGuard,
} from '../../src/modules/localtask/panel-guard.js';
import { countWaitingTopics } from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-panel-guard-'));
const storeFile = join(tmp, 'localtasks.json');
process.env.NX_KV_LOCALTASK_STORE = storeFile;

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

// "YYYY-MM-DD HH:mm:ss"（本地）——store 里的时间戳格式
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function writeStore(topics) {
  writeFileSync(storeFile, JSON.stringify({ version: 4, settings: {}, topics }, null, 2), 'utf8');
}

const WAITING_TOPIC = (until) => ({
  key: 'aaaa',
  cwd: 'D:\\x\\proj',
  name: 'proj',
  createdAt: stamp(new Date()),
  updatedAt: stamp(new Date()),
  waiting: true,
  waitingUntil: until,
  summary: '等待中',
  tasks: [],
});

// ─── 1. 纯判定 ────────────────────────────────────────────────────

test('shouldAutoExit：非 auto-exit 模式永不释放（手动 serve 不会自己跑掉）', () => {
  const base = { sawClient: true, idleForMs: 999_999, liveClients: 0, waitingTopics: 0 };
  assert.equal(shouldAutoExit({ ...base, autoExit: false }), false);
  assert.equal(shouldAutoExit({ ...base, autoExit: true }), true);
});

test('shouldAutoExit：有等待中的主题 / 有活标签时一律不释放', () => {
  const busy = { autoExit: true, sawClient: true, idleForMs: 999_999, waitingTopics: 1, liveClients: 0 };
  assert.equal(shouldAutoExit(busy), false);
  assert.equal(shouldAutoExit({ ...busy, waitingTopics: 0, liveClients: 2 }), false);
});

test('shouldAutoExit：见过面板后按短宽限，从未连过按长宽限', () => {
  const cfg = { idleMs: 120_000, neverSeenIdleMs: 600_000 };
  const seen = { autoExit: true, sawClient: true, liveClients: 0, waitingTopics: 0 };
  assert.equal(shouldAutoExit({ ...seen, idleForMs: 119_999 }, cfg), false);
  assert.equal(shouldAutoExit({ ...seen, idleForMs: 120_000 }, cfg), true);

  const never = { ...seen, sawClient: false };
  assert.equal(shouldAutoExit({ ...never, idleForMs: 599_999 }, cfg), false);
  assert.equal(shouldAutoExit({ ...never, idleForMs: 600_000 }, cfg), true);
});

test('shouldAutoExit：缺快照按「不释放」处理', () => {
  assert.equal(shouldAutoExit(null), false);
  assert.equal(shouldAutoExit(undefined), false);
});

// ─── 2. 过期 waiting 标志 ────────────────────────────────────────

test('countWaitingTopics：截止时刻已过的残留 waiting 不计入（wait 被强杀不阻塞释放）', async () => {
  const past = new Date(Date.now() - 60_000);
  writeStore({ a: WAITING_TOPIC(stamp(past)) });
  assert.equal(await countWaitingTopics(), 0);
});

test('countWaitingTopics：正常等待中计入；非等待主题不计入', async () => {
  const future = new Date(Date.now() + 120_000);
  writeStore({
    a: WAITING_TOPIC(stamp(future)),
    b: { ...WAITING_TOPIC(''), waiting: false },
    c: { ...WAITING_TOPIC(stamp(future)), waiting: false },
  });
  assert.equal(await countWaitingTopics(), 1);
});

test('countWaitingTopics：store 缺失时按 0 处理（不因读盘异常卡住释放）', async () => {
  rmSync(storeFile, { force: true });
  assert.equal(await countWaitingTopics(), 0);
});

// ─── 3. 看门狗 ───────────────────────────────────────────────────

function fakeServer() {
  const calls = { closeAllConnections: 0, close: 0 };
  return {
    calls,
    closeAllConnections() {
      calls.closeAllConnections += 1;
    },
    close(cb) {
      calls.close += 1;
      if (cb) cb();
    },
    address() {
      return { port: 7877 };
    },
  };
}

function makeGuard({ now, getWaiting = () => 0, getLive = () => 0, idleSec = 60 }) {
  const server = fakeServer();
  const state = { exited: 0, logs: [] };
  const guard = startPanelIdleGuard({
    server,
    now,
    idleSec,
    tickMs: 3_600_000, // 测试直接手动 tick，不用真实定时器
    getWaiting,
    getLive,
    log: (m) => state.logs.push(m),
    onExit: () => {
      state.exited += 1;
    },
  });
  return { guard, server, state };
}

test('看门狗：未到宽限不释放，到了释放一次且只一次', async () => {
  let t = 5_000_000;
  const now = () => t;
  const { guard, server, state } = makeGuard({ now });

  guard.noteActivity(); // 面板连过一次 → 走短宽限
  await guard.tick();
  assert.equal(state.exited, 0, '刚有活动不该释放');

  t += 30_000;
  await guard.tick();
  assert.equal(state.exited, 0, '静默 30s（< 60s 宽限）不该释放');

  t += 31_000;
  await guard.tick();
  assert.equal(state.exited, 1, '静默 61s 应释放');
  assert.equal(server.calls.closeAllConnections, 1, '先掐残留连接再 close');
  assert.equal(server.calls.close, 1);
  assert.match(state.logs.join('\n'), /自动释放 serve/);

  t += 600_000;
  await guard.tick();
  assert.equal(state.exited, 1, '释放后不再重复释放');
  guard.stop();
});

test('看门狗：有等待中的主题时静默再久也不释放，wait 收尾后才释放', async () => {
  let t = 9_000_000;
  const now = () => t;
  let waiting = 1; // 有 agent 正阻塞等人
  const { guard, state } = makeGuard({ now, getWaiting: () => waiting });

  guard.noteActivity();
  t += 3_600_000; // 页面已关，静默 1 小时
  await guard.tick();
  assert.equal(state.exited, 0, '有 agent 在等待时绝不释放（面板是唯一提醒源）');

  waiting = 0; // wait 收尾、清了 waiting；页面仍关着
  t += 1;
  await guard.tick();
  assert.equal(state.exited, 1, '等待结束且页面已关 → 释放');

  guard.stop();
});

test('看门狗：活标签也在时（切页但页面仍开着）不释放', async () => {
  let t = 0;
  const now = () => t;
  const { guard, state } = makeGuard({ now, getLive: () => 1 });

  guard.noteActivity();
  t += PANEL_IDLE_DEFAULTS.idleMs * 4;
  await guard.tick();
  assert.equal(state.exited, 0);
  guard.stop();
});

test('看门狗：从未见过客户端（开页失败／headless）用长宽限，避免与 wait 重开页抖动', async () => {
  let t = 0;
  const now = () => t;
  const { guard, state } = makeGuard({ now, idleSec: 60 });

  t += 60_000; // 已过短宽限，但从未连过客户端
  await guard.tick();
  assert.equal(state.exited, 0);

  t += PANEL_IDLE_DEFAULTS.neverSeenIdleMs;
  await guard.tick();
  assert.equal(state.exited, 1);
  guard.stop();
});
