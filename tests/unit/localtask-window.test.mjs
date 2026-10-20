// 「wait 为什么会重复开窗口」这条链路的回归测试。
//
// 根因是 presence 恒为 0（面板只轮询、不连 SSE），于是 wait 每次开页、
// 等待期间每 20s 再开一个。两处都要钉住：
//   1. shouldReopenWindow：有活标签 / 冷却中 / 开够次数 → 不开；
//   2. panelPresence：SSE 连上算 1 个活标签，断开立刻归零（这是 wait 唯一的判据）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
