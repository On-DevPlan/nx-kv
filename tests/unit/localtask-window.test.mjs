// 「wait 为什么会重复开窗口」这条链路的回归测试。
//
// 历史上两次根因：
//   1. presence 恒为 0（面板只轮询、不连 SSE）→ wait 每次开页、等待期间每 20s 再开一个；
//   2. 活性判据只数 localtask 页 SSE（切页即断）、只探默认端口（顺延/--port 看不见）
//      → 用户面板明明开着，wait 仍反复开标签。
// 钉住四处：
//   1. shouldReopenWindow：有活标签 / 冷却中 / 开够次数 → 不开；
//   2. panelPresence：SSE 连上算 1 个活标签，断开立刻归零；
//   3. effectivePresenceFrom：SSE 或 panelActive（面板停在任意页）都算开着；
//   4. findRunningAmongPorts：非默认端口上的面板也能被发现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import http from 'node:http';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

process.env.NX_KV_LOCALTASK_STORE = join(mkdtempSync(join(tmpdir(), 'nx-kv-window-')), 'localtasks.json');

test('shouldReopenWindow：有活标签就不开', () => {
  assert.equal(svc.shouldReopenWindow({ presence: 1, now: 100000, lastOpenAt: 0, opens: 0 }), false);
  assert.equal(svc.shouldReopenWindow({ presence: 3, now: 100000, lastOpenAt: 0, opens: 0 }), false);
});

test('shouldReopenWindow：从没开过 → 该开', () => {
  assert.equal(svc.shouldReopenWindow({ presence: 0, now: 100000, lastOpenAt: 0, opens: 0 }), true);
});

test('shouldReopenWindow：冷却期内不开，过了冷却才开', () => {
  const base = { presence: 0, opens: 1 };
  // 默认冷却 20s：第 5s（页面还在加载）绝不能再开一个 —— 这是「一开就俩」的直接原因
  assert.equal(svc.shouldReopenWindow({ ...base, now: 5_000, lastOpenAt: 0 + 1 }), false);
  assert.equal(svc.shouldReopenWindow({ ...base, now: 19_999, lastOpenAt: 1 }), false);
  assert.equal(svc.shouldReopenWindow({ ...base, now: 20_001, lastOpenAt: 1 }), true);
});

test('shouldReopenWindow：开够 3 次就停手（浏览器拦脚本时不刷屏）', () => {
  const base = { presence: 0, now: 10 * 60 * 1000, lastOpenAt: 1 };
  assert.equal(svc.shouldReopenWindow({ ...base, opens: 2 }), true);
  assert.equal(svc.shouldReopenWindow({ ...base, opens: 3 }), false);
  assert.equal(svc.shouldReopenWindow({ ...base, opens: 99 }), false);
});

test('shouldReopenWindow：冷却与上限可注入（测试/特殊场景）', () => {
  assert.equal(svc.shouldReopenWindow({ presence: 0, now: 1000, lastOpenAt: 900, opens: 0, cooldownMs: 50 }), true);
  assert.equal(svc.shouldReopenWindow({ presence: 0, now: 1000, lastOpenAt: 990, opens: 0, cooldownMs: 50 }), false);
  assert.equal(svc.shouldReopenWindow({ presence: 0, now: 1000, lastOpenAt: 0, opens: 1, maxOpens: 1 }), false);
});

test('panelPresence：SSE 连上算 1 个活标签，断开归零', () => {
  const make = () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.write = () => true; // 心跳写
    return { req, res };
  };
  const before = svc.panelPresence().clients;
  assert.equal(before, 0, '用例之间不留残留连接');

  const a = make();
  svc.addEventStreamConn(a.req, a.res);
  assert.equal(svc.panelPresence().clients, 1);

  const b = make();
  svc.addEventStreamConn(b.req, b.res);
  assert.equal(svc.panelPresence().clients, 2);

  // 关掉一个标签页：req/res 的 close 都要能清理（浏览器两种都会触发）
  b.res.emit('close');
  assert.equal(svc.panelPresence().clients, 1);

  a.req.emit('close');
  assert.equal(svc.panelPresence().clients, 0);
});

// ─── 宽口径活性：SSE 或 panelActive ─────────────────────────────────

test('effectivePresenceFrom：面板停在任意页（panelActive）也算开着', () => {
  // 用户切到别的页：SSE 断了，但 App 壳 15s 内打过 ping → 不能重开标签
  assert.equal(svc.effectivePresenceFrom({ clients: 0, total: 0, panelActive: true }), 1);
  // 停在 localtask 页：SSE 活标签
  assert.equal(svc.effectivePresenceFrom({ clients: 1, total: 1, panelActive: true }), 1);
  assert.equal(svc.effectivePresenceFrom({ clients: 3, total: 3, panelActive: false }), 1);
  // 真关了：SSE 无、ping 也没有
  assert.equal(svc.effectivePresenceFrom({ clients: 0, total: 0, panelActive: false }), 0);
  // 探测失败 / 旧版端点
  assert.equal(svc.effectivePresenceFrom(null), 0);
  assert.equal(svc.effectivePresenceFrom(undefined), 0);
});

// ─── 多端口发现 ────────────────────────────────────────────────────

// 假面板：/api/ping 应答 + /api/localtasks/presence 按给定快照应答。
async function startFakePanel({ clients = 0, panelActive = false } = {}) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { pong: true } }));
      return;
    }
    if (u.pathname === '/api/localtasks/presence') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ ok: true, data: { clients, total: clients, panelActive } })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
  };
}

// panels.json 在真实 APP_DIR 下：测试前后备份/还原，不污染用户注册表。
const PANELS_FILE = join(homedir(), '.nx-kv', 'panels.json');
function backupPanels() {
  return {
    exists: existsSync(PANELS_FILE),
    raw: existsSync(PANELS_FILE) ? readFileSync(PANELS_FILE, 'utf8') : null,
  };
}
function restorePanels(bak) {
  if (bak.exists) writeFileSync(PANELS_FILE, bak.raw, 'utf8');
  else rmSync(PANELS_FILE, { force: true });
}

test('findRunningAmongPorts：非默认端口上的面板能被发现', async () => {
  const fake = await startFakePanel({});
  try {
    // 显式候选集：只含一个不响应该端口与假面板端口 → 必须找到假端口
    // ⚠ dark 不能越界：临时端口高段（64536+）再 +1000 会超出 65535，
    // `http://127.0.0.1:65xxx` 直接 Invalid URL——不是「端口黑着」，是测试自己炸（随机翻车）。
    const dark = fake.port + 1000 <= 65535 ? fake.port + 1000 : fake.port - 1000;
    const found = await svc.findRunningAmongPorts([dark, fake.port], 300);
    assert.equal(found, fake.port, '顺延/--port 出来的面板应被发现');
    // 全部黑着 → null（wait 才会去拉起新实例）
    const none = await svc.findRunningAmongPorts([dark], 300);
    assert.equal(none, null);
  } finally {
    await fake.close();
  }
});

test('queryPanelPresence：非默认端口面板的 panelActive 计入汇总', async () => {
  const bak = backupPanels();
  // 假面板停在「别的页」：SSE 0、但 ping 活跃
  const fake = await startFakePanel({ clients: 0, panelActive: true });
  try {
    svc.registerPanel(fake.port);
    const q = await svc.queryPanelPresence(300);
    assert.equal(q.panelActive, true, '非默认端口面板的 ping 活跃应被汇总');
    // wait 因此判「面板开着」→ 不再开标签
    assert.equal(svc.effectivePresenceFrom(q), 1);
  } finally {
    await fake.close();
    restorePanels(bak);
  }
});
