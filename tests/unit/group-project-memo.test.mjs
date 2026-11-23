// #187：组的归属项目记忆（localStorage）——记住上次选择，下次默认用它。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// node 环境没有 localStorage：给一个最小实现
class MemStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
globalThis.localStorage = new MemStorage();

const { readGroupProject, rememberGroupProject } = await import(
  '../../src/web/frontend/page/group/group-project-memo.js'
);

beforeEach(() => { globalThis.localStorage = new MemStorage(); });

test('没记过 → 空串；记过 → 按 board id 取回', () => {
  assert.equal(readGroupProject('b_1'), '');
  rememberGroupProject('b_1', 'github.com/a/one');
  assert.equal(readGroupProject('b_1'), 'github.com/a/one');
  // 不同组互不影响
  assert.equal(readGroupProject('b_2'), '');
});

test('重复写同一个值不重复落盘（幂等）；脏参数直接忽略', () => {
  rememberGroupProject('b_1', 'k1');
  rememberGroupProject('b_1', 'k1');
  assert.equal(readGroupProject('b_1'), 'k1');
  rememberGroupProject('', 'k2');
  rememberGroupProject('b_1', '');
  assert.equal(readGroupProject(''), '');
  assert.equal(readGroupProject('b_1'), 'k1');
});

test('脏数据（非 JSON / 非对象）不炸读取', () => {
  localStorage.setItem('nx-kv-group-project-v1', '{bad json');
  assert.equal(readGroupProject('b_1'), '');
  localStorage.setItem('nx-kv-group-project-v1', '"str"');
  assert.equal(readGroupProject('b_1'), '');
});
