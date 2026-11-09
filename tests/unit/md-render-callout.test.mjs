// #144：md 渲染器的 callout 支持——`> [!TYPE] 标题` 渲染成醒目色块
// （div.md-callout.md-callout-<type>），无标记的连续引用行合成一个 blockquote。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownHtml } from '../../src/web/frontend/modules/md/md-parse.js';

test('callout：[!NOTE] 带标题渲染成 md-callout 块（标题 + 正文）', () => {
  const src = ['> [!NOTE] 第 1 轮 · 完成总结', '> 做完了 A', '> 第二行'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('<div class="md-callout md-callout-note">'));
  assert.ok(html.includes('<div class="md-callout-t">第 1 轮 · 完成总结</div>'));
  assert.ok(html.includes('做完了 A<br>第二行'));
  assert.ok(!html.includes('<blockquote>'), 'callout 不再渲染成引用框');
});

test('callout：[!WARNING] 加粗反馈行 → <b>，标题与正文分离', () => {
  const src = ['> [!WARNING] 第 2 轮 · 验收反馈', '> **还是卡顿**', '> **第二处也要改**'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('<div class="md-callout md-callout-warning">'));
  assert.ok(html.includes('<div class="md-callout-t">第 2 轮 · 验收反馈</div>'));
  assert.ok(html.includes('<b>还是卡顿</b><br><b>第二处也要改</b>'));
});

test('callout：正文里的空行分段（段间 <br> 连接）', () => {
  const src = ['> [!NOTE] 第 1 轮 · 完成总结', '> 第一段', '>', '> 第二段'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('第一段<br><br>第二段'));
});

test('无标记的连续引用行合成一个 blockquote（锚定引用不再拆成散框）', () => {
  const src = ['> 锚定：', '> 选区文字'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.equal((html.match(/<blockquote>/g) || []).length, 1);
  assert.ok(html.includes('锚定：<br>选区文字'));
});

test('单个引用行维持 blockquote 行为不变', () => {
  const html = renderMarkdownHtml('前文\n\n> 一行引用\n\n后文');
  assert.equal((html.match(/<blockquote>/g) || []).length, 1);
  assert.ok(html.includes('<p>前文</p>'));
  assert.ok(html.includes('<p>后文</p>'));
});

test('callout 块前后有普通内容时互不干扰（逐块渲染口径）', () => {
  const src = [
    '# 标题',
    '',
    '普通正文',
    '',
    '> [!NOTE] 第 1 轮 · 完成总结',
    '> 总结内容',
    '',
    '后续正文',
  ].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('<h1 id="'));
  assert.ok(html.includes('<p>普通正文</p>'));
  assert.ok(html.includes('md-callout-note'));
  assert.ok(html.includes('<p>后续正文</p>'));
});

test('fenced code 里的 [!NOTE] 不触发 callout（代码原样输出）', () => {
  const src = '```\n> [!NOTE] 这是代码\n```\n';
  const html = renderMarkdownHtml(src);
  assert.ok(!html.includes('md-callout'));
  assert.ok(html.includes('&gt; [!NOTE] 这是代码'));
});
