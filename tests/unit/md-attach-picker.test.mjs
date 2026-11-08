import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atTriggerAt, embedForAttachment } from '../../src/web/frontend/modules/md/attach-mention.js';

// #108：md 编辑器里打 @ 唤起附件选择面板。
// 这里覆盖两个纯函数：触发点判定（atTriggerAt）与引用语法生成（embedForAttachment）。

const fakeTa = (value, selectionStart, selectionEnd = selectionStart) => ({ value, selectionStart, selectionEnd });

test('atTriggerAt：光标前是 @ → 触发（返回 @ 的位置与光标）', () => {
  const hit = atTriggerAt(fakeTa('正文@', 3));
  assert.ok(hit, '应该触发');
  assert.equal(hit.at, 2);
  assert.equal(hit.caret, 3);
});

test('atTriggerAt：前面是词字符不触发（邮箱/句中不算）', () => {
  assert.equal(atTriggerAt(fakeTa('mail@', 5)), null);
  assert.equal(atTriggerAt(fakeTa('a_b@', 4)), null);
});

test('atTriggerAt：中文后可直接 @（不误伤）', () => {
  const hit = atTriggerAt(fakeTa('你好@', 3));
  assert.ok(hit);
  assert.equal(hit.at, 2);
});

test('atTriggerAt：不是 @ / 有选区 / 行首都不触发', () => {
  assert.equal(atTriggerAt(fakeTa('正文', 2)), null);
  assert.equal(atTriggerAt(fakeTa('@正文', 3)), null); // @ 不在光标前
  assert.equal(atTriggerAt(fakeTa('@@', 2, 1)), null); // 有选区
});

test('embedForAttachment：图片用 ![]()、文件用 []()（fileId）', () => {
  assert.equal(
    embedForAttachment({ kind: 'image', id: 'abc123', name: '图.png' }),
    '![图.png](abc123)'
  );
  assert.equal(
    embedForAttachment({ kind: 'file', id: 'def456', name: '报告.pdf' }),
    '[报告.pdf](def456)'
  );
});

test('embedForAttachment：URL / 任务 / 文档引用', () => {
  assert.equal(
    embedForAttachment({ kind: 'url', url: 'https://example.com', name: '链接' }),
    '[链接](https://example.com)'
  );
  assert.equal(
    embedForAttachment({ kind: 'task', taskId: 42, name: '#7 标题' }),
    '[#7 标题](nxkv://task/42)'
  );
  assert.equal(
    embedForAttachment({ kind: 'ref', refId: 'r_9', name: '设计文档' }),
    '[设计文档](nxkv://ref/r_9)'
  );
});

test('embedForAttachment：名字里的方括号被去掉（免得破 markdown）', () => {
  assert.equal(
    embedForAttachment({ kind: 'file', id: 'x1', name: 'a[b].txt' }),
    '[ab.txt](x1)'
  );
});
