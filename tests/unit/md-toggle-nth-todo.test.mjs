import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleNthTodo } from '../../src/web/frontend/modules/md/md-edit-ops.js';

// #99：视图态点击复选框切换待办状态——toggleNthTodo 是纯函数，直接全量单测。

test('toggleNthTodo：[ ] → [x]', () => {
  assert.equal(toggleNthTodo('- [ ] 买牛奶', 0), '- [x] 买牛奶');
});

test('toggleNthTodo：[x] → [ ]（小写 x 退回未完成）', () => {
  assert.equal(toggleNthTodo('- [x] 写报告', 0), '- [ ] 写报告');
});

test('toggleNthTodo：[X] 大写也认（渲染器 /x/i 同口径）', () => {
  assert.equal(toggleNthTodo('- [X] 大事', 0), '- [ ] 大事');
});

test('toggleNthTodo：多行块按出现序取第 n 个', () => {
  const src = '- [ ] 甲\n- [x] 乙\n- [ ] 丙';
  assert.equal(toggleNthTodo(src, 0), '- [x] 甲\n- [x] 乙\n- [ ] 丙');
  assert.equal(toggleNthTodo(src, 1), '- [ ] 甲\n- [ ] 乙\n- [ ] 丙');
  assert.equal(toggleNthTodo(src, 2), '- [ ] 甲\n- [x] 乙\n- [x] 丙');
});

test('toggleNthTodo：普通列表与非列表行原样保留', () => {
  const src = '- 普通项\n- [ ] 待办\n文字行\n- [ ] 另一个';
  assert.equal(
    toggleNthTodo(src, 0),
    '- 普通项\n- [x] 待办\n文字行\n- [ ] 另一个'
  );
  assert.equal(
    toggleNthTodo(src, 1),
    '- 普通项\n- [ ] 待办\n文字行\n- [x] 另一个'
  );
});

test('toggleNthTodo：没有第 n 个返回 null（不误改）', () => {
  assert.equal(toggleNthTodo('- [ ] 唯一', 1), null);
  assert.equal(toggleNthTodo('没有待办的块', 0), null);
  assert.equal(toggleNthTodo('', 0), null);
  assert.equal(toggleNthTodo(null, 0), null);
});

test('toggleNthTodo：缩进的嵌套待办也认（渲染器 ^-\\s+ 允许行首空白？至少不崩）', () => {
  // 渲染器只认顶格 `-`；缩进行即使改了也不影响渲染口径，翻转按序号数即可
  const src = '- [ ] 甲\n  - [ ] 嵌套';
  const out = toggleNthTodo(src, 1);
  assert.equal(out, '- [ ] 甲\n  - [x] 嵌套');
});
