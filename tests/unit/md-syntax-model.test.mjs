// 语法模型层（components/md/model）新增语法的渲染回归：
// 表格 / 数学公式（含矩阵）/ 斜体 / 删除线 / 分隔线 / 有序列表，以及块模型对
// 多行公式块的保护。这些是任务 #239「md 编辑器重构」交付的能力。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMarkdownHtml,
  splitMdBlocks,
} from '../../src/web/frontend/modules/md/md-parse.js';

// ── 表格（GFM pipe table）─────────────────────────────────────────────
test('table：表头 + 分隔行 + 数据行渲染成 md-table', () => {
  const src = ['| 名称 | 值 |', '| --- | --- |', '| a | 1 |', '| b | 2 |'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.match(html, /<table class="md-table">/);
  assert.ok(html.includes('<thead>'));
  assert.ok(html.includes('<th>名称</th>'));
  assert.ok(html.includes('<td>a</td>'));
  assert.ok(html.includes('<td>2</td>'));
});

test('table：对齐冒号映射成 text-align', () => {
  const src = ['| L | C | R |', '| :-- | :-: | --: |', '| 1 | 2 | 3 |'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('style="text-align:left"'));
  assert.ok(html.includes('style="text-align:center"'));
  assert.ok(html.includes('style="text-align:right"'));
});

test('table：单元格内的强调仍走行内渲染', () => {
  const src = ['| 说明 |', '| --- |', '| **粗** 与 *斜* |'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.ok(html.includes('<td><b>粗</b> 与 <em>斜</em></td>'));
});

test('table：没有分隔行的管道文本不会被误判成表格', () => {
  const html = renderMarkdownHtml('a | b | c');
  assert.doesNotMatch(html, /md-table/);
  assert.match(html, /<p>a \| b \| c<\/p>/);
});

// ── 数学公式 ─────────────────────────────────────────────────────────
test('math：块级 $$…$$ 渲染成 md-math-block', () => {
  const html = renderMarkdownHtml('$$\nE = mc^2\n$$');
  assert.match(html, /<div class="md-math-block">/);
  assert.ok(html.includes('<sup>2</sup>'));
});

test('math：matrix 矩阵环境渲染成行列网格', () => {
  const src = ['$$', '\\begin{pmatrix}', 'a & b \\\\', 'c & d', '\\end{pmatrix}', '$$'].join('\n');
  const html = renderMarkdownHtml(src);
  assert.match(html, /md-matrix/);
  assert.match(html, /md-mrow/);
  assert.ok(html.includes('<span class="md-mcell">a</span>'));
  assert.ok(html.includes('<span class="md-mcell">d</span>'));
});

test('math：行内 $…$ 渲染成 md-math-inline（含上标）', () => {
  const html = renderMarkdownHtml('质能方程 $E=mc^2$ 很简单');
  assert.match(html, /<span class="md-math-inline">/);
  assert.ok(html.includes('<sup>2</sup>'));
});

test('math：代码块里的 $ 不被当公式', () => {
  const html = renderMarkdownHtml('```\n$a^2$\n```');
  assert.doesNotMatch(html, /md-math/);
  assert.ok(html.includes('$a^2$'));
});

test('math：分式 \\frac 渲染成上下结构', () => {
  const html = renderMarkdownHtml('$$\\frac{a}{b}$$');
  assert.ok(html.includes('md-frac'));
  assert.ok(html.includes('md-frac-num'));
});

// ── 强调 / 删除线 ────────────────────────────────────────────────────
test('emphasis：斜体 *x* → <em>', () => {
  assert.ok(renderMarkdownHtml('这是 *斜体* 文本').includes('<em>斜体</em>'));
});

test('emphasis：删除线 ~~x~~ → <del>', () => {
  assert.ok(renderMarkdownHtml('这是 ~~废弃~~ 文本').includes('<del>废弃</del>'));
});

test('emphasis：粗体仍走 <b>，不会和斜体打架', () => {
  const html = renderMarkdownHtml('**粗** 和 *斜*');
  assert.ok(html.includes('<b>粗</b>'));
  assert.ok(html.includes('<em>斜</em>'));
});

// ── 分隔线 / 有序列表 ────────────────────────────────────────────────
test('divider：--- 独占行渲染成 hr', () => {
  assert.ok(renderMarkdownHtml('上文\n\n---\n\n下文').includes('<hr class="md-divider">'));
});

test('ordered-list：1. 2. 渲染成 ol', () => {
  const html = renderMarkdownHtml('1. 第一步\n2. 第二步');
  assert.match(html, /<ol>/);
  assert.ok(html.includes('<li>第一步</li>'));
  assert.ok(html.includes('<li>第二步</li>'));
});

// ── 块模型：多行公式块不被空行切散 ──────────────────────────────────
test('splitMdBlocks：$$ 公式块（含内部空行）保持为一块', () => {
  const body = ['前言', '', '$$', '\\begin{matrix}', '1 & 2 \\\\', '', '3 & 4', '\\end{matrix}', '$$', '', '后记'].join('\n');
  const blocks = splitMdBlocks(body);
  const mathBlock = blocks.find((b) => b.trim().startsWith('$$'));
  assert.ok(mathBlock, '存在公式块');
  assert.ok(mathBlock.includes('\\end{matrix}'), '公式块内含结束标记（未被切散）');
  assert.ok(mathBlock.includes('3 & 4'), '跨空行的矩阵行仍在同一块');
});
