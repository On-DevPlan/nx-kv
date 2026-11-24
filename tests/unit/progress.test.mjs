import {
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  hitQuery,
  matchSegments,
  matchCharsInOrder,
  cardIdOf,
} from '../../src/web/frontend/modules/md/progress-search.js';
import {
  normalizeTask,
} from '../../src/modules/localtask/lifecycle/task-view.js';
import {
  taskToProgress,
} from '../../src/web/frontend/modules/md/md-parse.js';
const card = (id, title) => ({ id, title });

test('cardIdOf：组模式取 taskId，目录模式退回 id', () => {
  assert.equal(cardIdOf({ id: 7, taskId: 9 }), '9');
  assert.equal(cardIdOf({ id: 7 }), '7');
  assert.equal(cardIdOf({}), '');
});

test('纯数字：编号等值命中（12 → #12）', () => {
  assert.equal(hitQuery(card(12, '无关标题'), '12'), true);
  assert.equal(hitQuery(card(12, '无关标题'), '#12'), true);
  assert.equal(hitQuery(card(21, '无关标题'), '12'), false);
});

test('纯数字：编号前缀命中（12 → 120-129 这一段）', () => {
  for (const id of [120, 121, 122, 129]) {
    assert.equal(hitQuery(card(id, '无关标题'), '12'), true, `#${id} 应被 12 命中`);
  }
  assert.equal(hitQuery(card(1200, '无关标题'), '12'), true, '前缀口径：1200 也算 12x');
  assert.equal(hitQuery(card(21, '无关标题'), '12'), false);
  assert.equal(hitQuery(card(3, '无关标题'), '12'), false);
});

test('纯数字：标题逐位通配（12 ≡ 1*2——「1」在前、「2」在后，中间可夹字符）', () => {
  assert.equal(hitQuery(card(1, '1*2'), '12'), true, '标题字面就是 1*2');
  assert.equal(hitQuery(card(1, '第1章 第2节'), '12'), true);
  assert.equal(hitQuery(card(1, '修复 v1 的 2 个问题'), '12'), true);
  assert.equal(hitQuery(card(1, '修复12个问题'), '12'), true, '相邻也算');
  assert.equal(hitQuery(card(1, '第2节 第1章'), '12'), false, '顺序不对不命中');
  assert.equal(hitQuery(card(1, '只有1没有别的'), '12'), false, '没有 2 就不命中');
});

test('显式通配（1*2 / 12* / *2）：按段顺序匹配标题与编号', () => {
  assert.equal(hitQuery(card(1, '第1章 第2节'), '1*2'), true);
  assert.equal(hitQuery(card(1, '第2节 第1章'), '1*2'), false);
  assert.equal(hitQuery(card(12, '任意标题'), '1*2'), true, '编号 12 也满足 1*2');
  assert.equal(hitQuery(card(120, '任意标题'), '12*'), true);
  assert.equal(hitQuery(card(1, '修复 2 号问题'), '*2'), true);
  assert.equal(hitQuery(card(1, '没有数字'), '1*2'), false);
});

test('普通文本：标题子串、忽略大小写；不因逐位通配而放宽', () => {
  assert.equal(hitQuery(card(1, 'Fix 登录页 500'), 'login'), false);
  assert.equal(hitQuery(card(1, 'Fix Login 500'), 'login'), true);
  assert.equal(hitQuery(card(1, '修复 LOGIN 问题'), 'login'), true);
  // 文本不做逐位通配：f-i-x 不该命中 "fix"
  assert.equal(hitQuery(card(1, 'f-i-x 修复'), 'fix'), false);
});

test('空查询 / 只有 # ：不过滤（全中）', () => {
  assert.equal(hitQuery(card(1, 'x'), ''), true);
  assert.equal(hitQuery(card(1, 'x'), '   '), true);
  assert.equal(hitQuery(card(1, 'x'), '#'), true);
});

test('底层：matchSegments 按顺序找段；matchCharsInOrder 逐位找', () => {
  assert.equal(matchSegments('abcabc', ['a', 'c']), true);
  assert.equal(matchSegments('abc', ['c', 'a']), false, '顺序反了不命中');
  assert.equal(matchSegments('abc', []), true);
  assert.equal(matchCharsInOrder('1x2', '12'), true);
  assert.equal(matchCharsInOrder('2x1', '12'), false);
  assert.equal(matchCharsInOrder('', '12'), false);
});

// ════ progress-search.test.mjs（#200 合并入本文件）════
test('normalizeTask：round = reopenCount + 1（数据口径不变，#127 只改 UI 语义）', () => {
  assert.equal(normalizeTask({ id: 1, status: 'pending', text: '# 根' }).round, 1);
  assert.equal(normalizeTask({ id: 2, status: 'done', text: '# 第三轮', reopenCount: 2 }).round, 3);
  assert.equal(normalizeTask({ id: 3, status: 'pending', text: '# 旧数据', reopenCount: 0 }).round, 1);
  // 脏数据（负数）不下探：round 最少 1
  assert.equal(normalizeTask({ id: 4, status: 'pending', text: '# 脏', reopenCount: -5 }).round, 1);
});

test('taskToProgress：id 透传（五种分支都带）；不再带 round（#127 起 UI 用 #id）', () => {
  const base = { id: 9, text: '# 标题' };
  assert.equal(taskToProgress({ ...base, status: 'pending' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'claimed', consumedAt: '2026-11-09 10:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'done', completedAt: '2026-11-09 11:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'pending', deletedAt: '2026-11-09 11:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'pending', migratedTo: { side: 'cloud' } }).id, 9);
  // 卡片数据里不再有 round——面板显示与搜索都走编号（结构上防止回退到 #122 语义）
  assert.equal(taskToProgress({ ...base, status: 'pending', round: 4 }).round, undefined);
});

