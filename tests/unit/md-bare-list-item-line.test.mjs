import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBareListItemLine } from '../../src/web/frontend/modules/md/md-edit-ops.js';

// #100：空列表项行（只有裸前缀）上按 Backspace = 剥前缀逃出列表、落空白行。
// isBareListItemLine 是判定核心——它必须认「前缀行」、必须拒绝「有内容的行」，
// 否则 `- 待办|` 会被整行误删。

test('裸前缀行：无序 / 待办 / 有序 / 末尾残留横杠', () => {
  assert.equal(isBareListItemLine('- '), true);
  assert.equal(isBareListItemLine('-'), true);
  assert.equal(isBareListItemLine('- [ ] '), true);
  assert.equal(isBareListItemLine('- [x] '), true);
  assert.equal(isBareListItemLine('1. '), true);
  assert.equal(isBareListItemLine('* '), true);
  assert.equal(isBareListItemLine('+ '), true);
  assert.equal(isBareListItemLine('  - '), true, '缩进前缀也认');
});

test('有内容的行 / 空串：不是裸前缀行（防整行误删）', () => {
  assert.equal(isBareListItemLine('- 待办'), false);
  assert.equal(isBareListItemLine('- 甲'), false);
  assert.equal(isBareListItemLine('- [ ] 半截['), false, '未闭合待办不是裸前缀');
  assert.equal(isBareListItemLine(''), false);
  assert.equal(isBareListItemLine('普通文字'), false);
  assert.equal(isBareListItemLine(null), false);
});

test('有序裸前缀必须带空格（`1.` 可能是句子结尾）', () => {
  assert.equal(isBareListItemLine('1.'), false);
  assert.equal(isBareListItemLine('12. '), true);
});
