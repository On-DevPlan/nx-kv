// ack 定位轨拖动落点的纯逻辑（任务 #55）：钳制 + localStorage 存取。
// 组件侧（components/md/ack-rail.jsx）只做指针编排，落点语义全在这层验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRailPos, loadRailPos, saveRailPos, RAIL_MARGIN } from '../../src/web/frontend/modules/board/ack-rail-pos.js';

// node 没有 localStorage——桩一个内存版（模块在调用时才摸它，桩在 import 后也生效）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

test('clampRailPos：界内不动', () => {
  assert.deepEqual(
    clampRailPos({ x: 100, y: 200, parentW: 800, parentH: 600, railW: 28, railH: 120 }),
    { x: 100, y: 200 },
  );
});

test('clampRailPos：四边出界都钳回 margin 内', () => {
  const W = 800;
  const H = 600;
  const railW = 28;
  const railH = 120;
  assert.deepEqual(clampRailPos({ x: -50, y: -5, parentW: W, parentH: H, railW, railH }), {
    x: RAIL_MARGIN,
    y: RAIL_MARGIN,
  });
  assert.deepEqual(clampRailPos({ x: 9999, y: 9999, parentW: W, parentH: H, railW, railH }), {
    x: W - railW - RAIL_MARGIN,
    y: H - railH - RAIL_MARGIN,
  });
});

test('clampRailPos：容器比轨还小时钳到 margin（宁可贴边不出界）', () => {
  assert.deepEqual(
    clampRailPos({ x: 50, y: 50, parentW: 30, parentH: 40, railW: 28, railH: 120 }),
    { x: RAIL_MARGIN, y: RAIL_MARGIN },
  );
});

test('clampRailPos：非法输入 → null（调用方放弃本次更新）', () => {
  assert.equal(clampRailPos({ x: NaN, y: 0, parentW: 800, parentH: 600 }), null);
  assert.equal(clampRailPos({ x: 0, y: 0, parentW: undefined, parentH: 600 }), null);
  assert.equal(clampRailPos(null), null);
});

test('save/load 往返 + 清除', () => {
  assert.equal(loadRailPos(), null, '初始无记录');
  saveRailPos({ x: 123.6, y: 88.2 });
  assert.deepEqual(loadRailPos(), { x: 124, y: 88 }, '取整存、原样读');
  saveRailPos(null);
  assert.equal(loadRailPos(), null, 'null 清记录');
});

test('脏数据不炸：坏 JSON / 非数值 → null', () => {
  saveRailPos({ x: 1, y: 2 });
  mem.set('nx-kv-ack-rail-pos', '{oops');
  assert.equal(loadRailPos(), null);
  mem.set('nx-kv-ack-rail-pos', JSON.stringify({ x: 'left', y: null }));
  assert.equal(loadRailPos(), null);
  mem.set('nx-kv-ack-rail-pos', JSON.stringify([1, 2]));
  assert.equal(loadRailPos(), null);
});
