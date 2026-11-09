// 进程面板搜索匹配（#127 → #129）：纯函数，无 DOM、无 IO。
//
// #129 的验收反馈原文：「仍然有问题 比如输入12 应该显示12、120-129、1*2这些」
// ——纯数字查询不只该命中编号等值，还要命中同前缀的编号段（120-129）与
// 标题里「1…2」这种隔着字符的写法（1*2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hitQuery,
  matchSegments,
  matchCharsInOrder,
  cardIdOf,
} from '../../src/web/frontend/modules/md/progress-search.js';

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
