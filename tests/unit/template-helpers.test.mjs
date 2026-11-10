// 模板 helper（#90）：比较 / 逻辑 / 数值 / 串 / 时间。
//
// 三个必须钉住的约定（docs/glossary.md 同口径）：
//   1. helper 绝不抛错——坏输入只影响自己那一小段输出；
//   2. 数值失败可见（`NaN`），比较失败一律 false（{{#if}} 安全走 else）；
//   3. 除零照 JS（Infinity / -Infinity / NaN），不特殊处理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInstruction, TEMPLATE_HELPERS } from '../../src/core/instruction-template.js';

const r = (tpl, ctx = {}) => renderInstruction(tpl, ctx).trim();

test('helper 清单：五类社区惯用命名都在', () => {
  for (const name of [
    'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between',
    'and', 'or', 'not',
    'add', 'sub', 'mul', 'div', 'mod', 'round', 'floor', 'ceil', 'percent', 'ratio', 'clamp',
    'includes', 'length', 'default',
    'formatDuration',
  ]) {
    assert.ok(TEMPLATE_HELPERS.includes(name), `${name} 已注册`);
  }
});

test('比较：数值按数比、字符串按串比；拿不到数 → false', () => {
  assert.equal(r('{{eq 1 "1"}}'), 'true');
  assert.equal(r('{{eq "abc" "abc"}}'), 'true');
  assert.equal(r('{{ne 1 2}}'), 'true');
  assert.equal(r('{{gt 3 2}}'), 'true');
  assert.equal(r('{{gte 2 2}}'), 'true');
  assert.equal(r('{{lt "-1" 0}}'), 'true');
  assert.equal(r('{{lte 2 1}}'), 'false');
  assert.equal(r('{{between 50 34 66}}'), 'true');
  assert.equal(r('{{between 67 34 66}}'), 'false');
  assert.equal(r('{{gt "abc" 1}}'), 'false', '非数比较不炸，返回 false');
  assert.equal(r('{{#if (gt "abc" 1)}}A{{else}}B{{/if}}'), 'B');
});

test('逻辑：and / or / not 与嵌套子表达式', () => {
  assert.equal(r('{{and 1 "x" true}}'), 'true');
  assert.equal(r('{{and 1 "" }}'), 'false');
  assert.equal(r('{{or "" 0 "x"}}'), 'true');
  assert.equal(r('{{not ""}}'), 'true');
  assert.equal(r('{{#if (and goal.check (lt goal.remainingSec 300))}}紧迫{{else}}宽松{{/if}}', {
    goal: { check: 'x', remainingSec: 120 },
  }), '紧迫');
});

test('数值：加减乘除取模、取整、百分比、比例、夹取；零值与坏输入照约定', () => {
  assert.equal(r('{{add 1 2 3}}'), '6');
  assert.equal(r('{{sub 10 3 2}}'), '5');
  assert.equal(r('{{mul 2 3 4}}'), '24');
  assert.equal(r('{{div 7 2}}'), '3.5');
  assert.equal(r('{{div 1 0}}'), 'Infinity', '除零照 JS');
  assert.equal(r('{{div 0 0}}'), 'NaN');
  assert.equal(r('{{mod 7 3}}'), '1');
  assert.equal(r('{{round 1.2345 2}}'), '1.23');
  assert.equal(r('{{round 2.5}}'), '3');
  assert.equal(r('{{floor 1.9}}'), '1');
  assert.equal(r('{{ceil 1.1}}'), '2');
  assert.equal(r('{{percent 1 2}}'), '50');
  assert.equal(r('{{percent 2 3 1}}'), '66.7');
  assert.equal(r('{{percent 1 0}}'), 'NaN', '总量为零 → 可见兜底');
  assert.equal(r('{{ratio 1 4}}'), '0.25');
  assert.equal(r('{{clamp 120 0 100}}'), '100');
  assert.equal(r('{{add 1 "x"}}'), 'NaN', '非数参与 → 可见兜底，不抛错');
});

test('字符串与时间：includes / length / default / formatDuration', () => {
  assert.equal(r('{{includes "hello world" "world"}}'), 'true');
  assert.equal(r('{{includes "hello" "x"}}'), 'false');
  assert.equal(r('{{length "abc"}}'), '3');
  assert.equal(r('{{length list}}', { list: [1, 2] }), '2');
  assert.equal(r('{{length missing}}'), '0');
  assert.equal(r('{{default missing "兜底"}}'), '兜底');
  assert.equal(r('{{default "  " "兜底"}}'), '兜底');
  assert.equal(r('{{default "有值" "兜底"}}'), '有值');
  assert.match(r('{{formatDuration 5400}}'), /1\.5\s*小时|90\s*分钟/);
});

test('示例模板：过半警告 / 2/3 收尾（用户原场景）', () => {
  const warn = '{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}〔过半警告〕已用 {{percent goal.elapsedSec goal.durationSec}}%，剩余 {{goal.remainingHuman}}。{{/if}}';
  const wrap = '{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}〔收尾整理〕已用 {{percent goal.elapsedSec goal.durationSec}}%，停止开新战线。{{/if}}';
  const ctx = { goal: { elapsedSec: 2400, durationSec: 3600, remainingHuman: '20 分钟' } };
  assert.match(r(warn, ctx), /过半警告.*66\.67%|过半警告.*67%/, '过半触发');
  assert.match(r(wrap, ctx), /收尾整理/, '2/3 触发');
  const early = { goal: { elapsedSec: 600, durationSec: 3600, remainingHuman: '50 分钟' } };
  assert.equal(r(warn, early), '', '未过半不出现');
  assert.equal(r(wrap, early), '', '未到 2/3 不出现');
});
