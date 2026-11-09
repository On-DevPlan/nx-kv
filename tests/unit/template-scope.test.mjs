// 模板可见域纯解析（#128）：scope 归一 / use / edit / 过滤——全部无 DB、无 IO。
// 口径（评估 §2）：可见 = "*" 或命中主题三把钥匙之一；可编辑 = origin 命中或
// scope 显式点名本主题（比 use 严："*" 只给用不给改）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScope,
  isScopeEntry,
  topicCtx,
  canUse,
  canEdit,
  visibleTemplates,
} from '../../src/modules/templates/scope.js';

const CTX = topicCtx({ key: 'a1b2c3d4e5f60718', repoKey: 'test/projA', groupKey: 'g_mvwc2mzrwnl' });

test('isScopeEntry：* 与三种前缀合法；空 key / 未知前缀 / 含空白不合法', () => {
  assert.equal(isScopeEntry('*'), true);
  assert.equal(isScopeEntry('topic:__GLOBAL__'), true);
  assert.equal(isScopeEntry('repo:test/projA'), true); // repo key 带 / 合法
  assert.equal(isScopeEntry('group:g_x'), true);
  assert.equal(isScopeEntry('topic:'), false); // 空 key
  assert.equal(isScopeEntry(':abc'), false); // 空前缀
  assert.equal(isScopeEntry('user:abc'), false); // 未知前缀
  assert.equal(isScopeEntry('topic:a b'), false); // 含空白
  assert.equal(isScopeEntry('abc'), false); // 裸串（没有冒号）
  assert.equal(isScopeEntry(''), false);
  assert.equal(isScopeEntry(null), false);
});

test('normalizeScope：数组去重保序；宽松档丢弃非法条目，严格档报错', () => {
  assert.deepEqual(normalizeScope(['topic:x', '*', 'topic:x', 'repo:y']), ['topic:x', '*', 'repo:y']);
  assert.deepEqual(normalizeScope('["*","topic:k"]'), ['*', 'topic:k']); // JSON 串（CLI）
  assert.deepEqual(normalizeScope(['garbage', '*']), ['*']); // 宽松：丢脏条目
  assert.deepEqual(normalizeScope(null), []);
  assert.deepEqual(normalizeScope(undefined), []);
  assert.deepEqual(normalizeScope(''), []);
  assert.throws(() => normalizeScope(['garbage'], { strict: true }), /不认识的条目/);
  assert.throws(() => normalizeScope('not-json', { strict: true }), /JSON 数组/);
  assert.throws(() => normalizeScope({ a: 1 }, { strict: true }), /JSON 数组/); // 对象不行
});

test('canUse："*" 短路；topic/repo/group 各自命中；全不中则不可见', () => {
  assert.equal(canUse({ scope: ['*'] }, CTX), true);
  assert.equal(canUse({ scope: ['topic:a1b2c3d4e5f60718'] }, CTX), true);
  assert.equal(canUse({ scope: ['repo:test/projA'] }, CTX), true);
  assert.equal(canUse({ scope: ['group:g_mvwc2mzrwnl'] }, CTX), true);
  assert.equal(canUse({ scope: ['topic:other'] }, CTX), false);
  assert.equal(canUse({ scope: [] }, CTX), false);
  assert.equal(canUse({ scope: ['topic:other', 'group:g_mvwc2mzrwnl'] }, CTX), true); // 任一命中
  // 脏数据防御：非数组 scope 一律不可见（除了走 normalize 兜出来的空数组）
  assert.equal(canUse({}, CTX), false);
  assert.equal(canUse({ scope: '["*"]' }, CTX), false); // service 层保证入参是数组
});

test('canEdit：origin 命中或 scope 显式点名；"*" 和 repo/group 域不给改', () => {
  const t = (over) => ({ scope: ['*'], originTopic: '', ...over });
  assert.equal(canEdit(t({ originTopic: CTX.key }), CTX), true); // 创建处
  assert.equal(canEdit(t({ scope: [`topic:${CTX.key}`] }), CTX), true); // 显式点名
  assert.equal(canEdit(t({ scope: ['*'] }), CTX), false); // 全局 ≠ 可改
  assert.equal(canEdit(t({ scope: ['repo:test/projA'] }), CTX), false); // repo 域也不给改
  assert.equal(canEdit(t({ scope: ['group:g_mvwc2mzrwnl'] }), CTX), false);
  assert.equal(canEdit(t({ originTopic: 'other' }), CTX), false);
});

test('visibleTemplates：过滤保持原顺序；perm 语义与 canUse 同构', () => {
  const list = [
    { id: 'a', scope: ['topic:other'] },
    { id: 'b', scope: ['*'] },
    { id: 'c', scope: ['repo:test/projA'] },
  ];
  assert.deepEqual(
    visibleTemplates(list, CTX).map((x) => x.id),
    ['b', 'c']
  );
  assert.deepEqual(visibleTemplates(null, CTX), []);
});
