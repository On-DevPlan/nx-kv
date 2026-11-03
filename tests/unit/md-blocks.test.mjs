// frontmatter 在 MD 工作台里的**独立成块**与属性卡渲染。
//
// 背景：任务正文头部带 frontmatter（board/project/介绍引用），此前它无声地
// 混在第一个内容块里——预览被吞掉、编辑态糊在第一行上。现在：
//   splitMdBlocks 让头部 frontmatter 自成一块（与标题同一待遇）；
//   renderMarkdownHtml 把它渲染成键值属性卡，预览与阅读视图同一份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitMdBlocks,
  joinMdBlocks,
  parseFrontmatter,
  frontmatterHtml,
  renderMarkdownHtml,
} from '../../src/web/frontend/modules/md/md-parse.js';

const FM = '---\nboard: b_1\nproject: local/x\n---';

test('splitMdBlocks：头部 frontmatter 自成一块，不与首行内容合并', () => {
  // frontmatter 后直接跟正文（无空行）——正是任务面板写入的形状
  const blocks = splitMdBlocks(`${FM}\n①目标：双列表页面版式改造`);
  assert.equal(blocks.length, 2, 'frontmatter 与正文各自一块');
  assert.equal(parseFrontmatter(blocks[0]).board, 'b_1', '块 0 就是 frontmatter');
  assert.match(blocks[1], /①目标/);
});

test('splitMdBlocks：frontmatter + 标题 + 正文三块分明', () => {
  const blocks = splitMdBlocks(`${FM}\n# 标题\n正文段`);
  assert.equal(blocks.length, 3);
  assert.equal(parseFrontmatter(blocks[0]).project, 'local/x');
  assert.match(blocks[1], /^# 标题$/);
  assert.equal(blocks[2], '正文段');
});

test('splitMdBlocks → joinMdBlocks 往返：frontmatter 仍可解析', () => {
  const src = `${FM}\n# 标题\n\n正文`;
  const back = joinMdBlocks(splitMdBlocks(src));
  const fm = parseFrontmatter(back);
  assert.equal(fm.board, 'b_1');
  assert.equal(fm.project, 'local/x');
  assert.match(back, /# 标题/);
  assert.match(back, /正文/);
});

test('splitMdBlocks：孤立的 ---（无闭合）不当作 frontmatter', () => {
  const blocks = splitMdBlocks('---\n只是一条分割线');
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /---/);
  assert.match(blocks[0], /分割线/);
});

test('splitMdBlocks：正文后部的 ---（thematic break）不当作 frontmatter', () => {
  const blocks = splitMdBlocks('# 标题\n正文上\n---\n正文下');
  // --- 与前后的正文没有空行 → 全在正文流里，不在头部位置
  assert.ok(blocks.some((b) => b.includes('正文上')), '正文上');
  assert.ok(!parseFrontmatter(blocks[0]).board, '块 0 不是 frontmatter');
});

test('frontmatterHtml：键值行 + HTML 转义；无 frontmatter 返回空串', () => {
  const html = frontmatterHtml(FM);
  assert.match(html, /class="mdw-fm"/);
  assert.match(html, /mdw-fm-k">board</);
  assert.match(html, /mdw-fm-v">local\/x</);
  // 值里的 HTML 不逃逸出去
  const evil = frontmatterHtml('---\nnote: <img src=x onerror=alert(1)>\n---');
  assert.doesNotMatch(evil, /<img src=x/);
  assert.match(evil, /&lt;img/);
  assert.equal(frontmatterHtml('# 无 frontmatter'), '');
});

test('renderMarkdownHtml：属性卡置顶，正文跟后；FM-only 正文只剩卡', () => {
  const html = renderMarkdownHtml(`${FM}\n# 标题\n\n正文段`);
  assert.ok(html.indexOf('mdw-fm') < html.indexOf('正文段'), '卡在正文前');
  assert.match(html, /<h1[^>]*>标题<\/h1>/);

  const only = renderMarkdownHtml(FM);
  assert.match(only, /class="mdw-fm"/);
  assert.doesNotMatch(only, /mdw-empty/);
});
