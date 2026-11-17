// #149 全局列表过滤口径：纯函数契约（src/web/frontend/modules/list-filter.ts）。
// 所有列表搜索框共用这一份匹配规则，在这里钉死，避免各页面各写一份分叉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterByKeyword,
  hasQuery,
} from '../../src/web/frontend/modules/list-filter.js';

const rows = [
  { name: 'Alpha', key: 'github.com/me/alpha', desc: '管清单的' },
  { name: 'Beta', key: 'github.com/me/beta', desc: '' },
  { name: 'Gamma', key: 'local/gamma', desc: '编辑器参考' },
];
const fields = (r) => [r.name, r.key, r.desc];
const names = (list) => list.map((r) => r.name);

test('空关键词返回全部（且不改原数组）', () => {
  assert.deepEqual(names(filterByKeyword(rows, '', fields)), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(names(filterByKeyword(rows, '   ', fields)), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(names(filterByKeyword(rows, undefined, fields)), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(names(filterByKeyword(rows, null, fields)), ['Alpha', 'Beta', 'Gamma']);
  const out = filterByKeyword(rows, '', fields);
  out.push({ name: 'X' });
  assert.equal(rows.length, 3, '返回的是副本');
});

test('单关键词命中任意字段，大小写不敏感', () => {
  assert.deepEqual(names(filterByKeyword(rows, 'alpha', fields)), ['Alpha']);
  assert.deepEqual(names(filterByKeyword(rows, 'ALPHA', fields)), ['Alpha']);
  assert.deepEqual(names(filterByKeyword(rows, 'github.com', fields)), ['Alpha', 'Beta']);
  assert.deepEqual(names(filterByKeyword(rows, '编辑器', fields)), ['Gamma']);
});

test('空格分词 = AND，词与词之间命中面可取不同字段', () => {
  assert.deepEqual(names(filterByKeyword(rows, 'me beta', fields)), ['Beta']);
  assert.deepEqual(names(filterByKeyword(rows, 'alpha 清单', fields)), ['Alpha']);
  assert.deepEqual(names(filterByKeyword(rows, 'alpha gamma', fields)), []);
});

test('空字段 / null / undefined 不参与匹配、也不报错', () => {
  const withNull = [{ name: 'X', key: null, desc: undefined }];
  assert.deepEqual(filterByKeyword(withNull, 'x', (r) => [r.name, r.key, r.desc]).length, 1);
  assert.deepEqual(filterByKeyword(withNull, 'null', (r) => [r.name, r.key, r.desc]), []);
});

test('正则元字符按字面处理，不抛错', () => {
  const weird = [{ name: 'a(b)[c]' }];
  assert.equal(filterByKeyword(weird, '(', (r) => [r.name]).length, 1);
  assert.equal(filterByKeyword(weird, '[', (r) => [r.name]).length, 1);
  assert.doesNotThrow(() => filterByKeyword(weird, '*', (r) => [r.name]));
  assert.doesNotThrow(() => filterByKeyword(weird, '(?', (r) => [r.name]));
});

test('空列表 / null 入参返回空数组', () => {
  assert.deepEqual(filterByKeyword([], 'x', fields), []);
  assert.deepEqual(filterByKeyword(null, 'x', fields), []);
  assert.deepEqual(filterByKeyword(undefined, 'x', fields), []);
});

test('hasQuery：纯空白视为无查询', () => {
  assert.equal(hasQuery('x'), true);
  assert.equal(hasQuery('  x  '), true);
  assert.equal(hasQuery(''), false);
  assert.equal(hasQuery('   '), false);
  assert.equal(hasQuery(null), false);
});
