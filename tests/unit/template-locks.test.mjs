// 模板骨架锁定判定（modules/md/template-locks.ts）：
// 「哪块只读、哪块是插槽」是纯派生——这里钉住派生的口径，不碰 UI。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTemplateLocks } from '../../src/web/frontend/modules/md/template-locks.js';
import { liveBodyBlocks } from '../../src/web/frontend/modules/md/md-blocks.js';

const TPL = [
  '## 本轮问题',
  '{{content}}',
  '---',
  '## 怎么干',
  '按四步走。',
].join('\n\n');

const taskOf = (body, fm = 'board: b_x\nproject: github.com/o/r') =>
  `---\n${fm}\ntemplate: newtask.ref\n---\n${body}`;

test('模板骨架块只读，插槽块可编辑', () => {
  const task = taskOf('## 本轮问题\n\n这里是我的问题\n\n---\n\n## 怎么干\n\n按四步走。');
  const { locked, slots } = computeTemplateLocks(task, TPL);
  // 正文块：0=frontmatter 1=## 本轮问题 2=插槽 3=--- 4=## 怎么干 5=按四步走。
  assert.ok(locked.has(1), '标题骨架块应只读');
  assert.ok(slots.has(2), '槽位块应可编辑');
  assert.ok(locked.has(3), '分隔线骨架块应只读');
  assert.ok(locked.has(4), '正文骨架块应只读');
  assert.ok(locked.has(5), '末段骨架块应只读');
  assert.equal(locked.has(2), false, '槽位块不能同时被判只读');
});

test('用户新增的块不锁定', () => {
  const task = taskOf('## 本轮问题\n\n问题\n\n## 我自己加的验收\n\n- [ ] 跑全量\n\n---\n\n## 怎么干\n\n按四步走。');
  const { locked } = computeTemplateLocks(task, TPL);
  const blocks = liveBodyBlocks(task);
  const extra = blocks.findIndex((b) => b.includes('我自己加的验收'));
  assert.ok(extra > 0);
  assert.equal(locked.has(extra), false);
});

test('骨架块被改写后不再锁定（只读只保护原样还在的骨架）', () => {
  const task = taskOf('## 本轮问题\n\n问题\n\n---\n\n## 怎么干（我改过）\n\n按四步走。');
  const { locked } = computeTemplateLocks(task, TPL);
  const idx = liveBodyBlocks(task).findIndex((b) => b.includes('我改过'));
  assert.equal(locked.has(idx), false);
});

test('frontmatter 与首个 H1 不干扰对齐', () => {
  const task = taskOf('# 我的任务标题\n\n## 本轮问题\n\n问题\n\n---\n\n## 怎么干\n\n按四步走。');
  const { locked, slots } = computeTemplateLocks(task, TPL);
  // liveBodyBlocks 剥 H1 后：0=frontmatter 1=## 本轮问题 2=插槽 3=--- 4=## 怎么干 5=按四步走。
  assert.ok(locked.has(1));
  assert.ok(slots.has(2));
  assert.ok(locked.has(4));
});

test('模板正文为空 / 任务正文为空 → 不锁定任何块', () => {
  assert.equal(computeTemplateLocks(taskOf('随便写'), '').locked.size, 0);
  assert.equal(computeTemplateLocks('', TPL).locked.size, 0);
});

test('没有槽位的模板不锁定（只读的前提是有可编辑出口）', () => {
  const tpl = '## A\n\n## B';
  const task = taskOf('## A\n\n## B');
  const { locked, slots } = computeTemplateLocks(task, tpl);
  assert.equal(locked.size, 0);
  assert.equal(slots.size, 0);
});

test('槽位块被删后，该位置仍按骨架对齐（不把分隔线误判成插槽）', () => {
  const tpl = '## 问题\n\n{{content}}\n\n---\n\n## 做法';
  const task = taskOf('## 问题\n\n---\n\n## 做法'); // 用户把槽位那块删了
  const { locked, slots } = computeTemplateLocks(task, tpl);
  assert.equal(slots.size, 0);
  assert.ok(locked.has(2), '分隔线应锁');
  assert.ok(locked.has(3), '末段骨架应锁');
});

test('槽位块有内容时就是可编辑插槽', () => {
  const tpl = '## 问题\n\n{{content}}\n\n---\n\n## 做法';
  const task = taskOf('## 问题\n\n我要问的是这个\n\n---\n\n## 做法');
  const { locked, slots } = computeTemplateLocks(task, tpl);
  assert.ok(slots.has(2));
  assert.ok(locked.has(1));
  assert.ok(locked.has(3));
});
