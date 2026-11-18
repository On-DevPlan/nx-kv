// 仓库管理页分支选择持久化（#158）：存取语义 + localStorage 缺席降级。
// 组件侧（page/repos/index.tsx）只做「切换即存、进页即读」，语义全在这层验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBranchPref, saveBranchPref } from '../../src/web/frontend/page/repos/branch-persist.js';

// node 没有 localStorage——桩一个内存版（模块在调用时才摸它，桩在 import 后也生效）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

test('存取：写入后原样读回', () => {
  saveBranchPref('brd_123');
  assert.equal(loadBranchPref(), 'brd_123');
});

test('无记录 → null（回落 main 由调用方做）', () => {
  mem.clear();
  assert.equal(loadBranchPref(), null);
});

test('脏数据守卫：空串不写，读回 null', () => {
  mem.clear();
  saveBranchPref('');
  assert.equal(loadBranchPref(), null, '空串不被写入');
  assert.equal(mem.size, 0, '空串连键都不落盘');
});

test('localStorage 缺席（隐私模式）→ 存取静默降级', async () => {
  // 暂时摘掉 localStorage：读写都不许抛
  const original = globalThis.localStorage;
  // @ts-expect-error 测试里故意破坏
  globalThis.localStorage = undefined;
  try {
    assert.equal(loadBranchPref(), null);
    assert.doesNotThrow(() => saveBranchPref('brd_x'));
  } finally {
    globalThis.localStorage = original;
  }
});
