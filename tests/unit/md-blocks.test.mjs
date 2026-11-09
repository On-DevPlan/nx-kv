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
  renderMarkdownHtml,
  normalizeBlockText,
  insertAttachmentSnippet,
  frontmatterEndOffset,
  liveBodyBlocks,
  isFrontmatterBlock,
  stripPhantomEmptyLines,
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

test('renderMarkdownHtml：frontmatter 不再渲染成属性卡（#113），正文照常', () => {
  const html = renderMarkdownHtml(`${FM}\n# 标题\n\n正文段`);
  assert.doesNotMatch(html, /mdw-fm/, '不再有属性卡');
  assert.match(html, /<h1[^>]*>标题<\/h1>/);
  assert.match(html, /正文段/);

  // 只剩 frontmatter 的正文：不再有属性卡（正文位空着）
  const only = renderMarkdownHtml(FM);
  assert.doesNotMatch(only, /mdw-fm/);
});

// ── 空格打不出来（任务 #21）────────────────────────────────────────
//
// 实时预览里每个空格都是**打在行尾**的。旧实现 joinMdBlocks 对每个块做
// `/\s+$/` 去尾随空白，于是「块 → 正文 → 块」往返一趟，刚敲下的空格就被吃掉：
// 空格永远打不出来（行中打字能进去，正因为它不在行尾）。这里钉住修好的行为。
test('joinMdBlocks：保留块尾空格（行尾敲下的空格不能被吃掉）', () => {
  assert.equal(joinMdBlocks(['abc ']), 'abc ');
  assert.equal(joinMdBlocks(['abc ', 'def']), 'abc \n\ndef');
});

test('splitMdBlocks → joinMdBlocks 往返：尾随空格不丢', () => {
  const back = joinMdBlocks(splitMdBlocks('abc \n\ndef'));
  assert.equal(back, 'abc \n\ndef');
  const blocks = splitMdBlocks(back);
  assert.equal(blocks[0], 'abc ', '尾随空格还在');
  assert.equal(blocks[1], 'def');
});

test('纯空白块：ZWSP 打头落盘，空格不丢（空块里也要能敲空格）', () => {
  const body = joinMdBlocks([' ']);
  assert.equal(body, '​ ', '空白块用 ZWSP 打头');
  const blocks = splitMdBlocks(body);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], ' ', '还原回一个空格');
});

test('空块仍是裸 ZWSP，往返还原成空块', () => {
  const body = joinMdBlocks(['']);
  assert.equal(body, '​');
  const blocks = splitMdBlocks(body);
  assert.deepEqual(blocks, ['']);
});

test('markdown 语义不变：正文里的纯空白行仍是块分隔符（不是块）', () => {
  const blocks = splitMdBlocks('a\n   \nb');
  assert.equal(blocks.length, 2, '空白行分隔块，不制造空白块');
  assert.deepEqual(blocks, ['a', 'b']);
});

test('normalizeBlockText：只剥 ZWSP，不动空白（编辑态原文）', () => {
  assert.equal(normalizeBlockText('abc '), 'abc ');
  assert.equal(normalizeBlockText(' '), ' ');
  assert.equal(normalizeBlockText('​'), '');
  assert.equal(normalizeBlockText('​ '), ' ');
});

// ── 附件嵌入落点（任务 #15：live 块内偏移被误当全文偏移 → 插进 FM）──────

const FID = 'a'.repeat(32);
const IMG = `\n![shot.png](${FID})\n`;

test('frontmatterEndOffset / isFrontmatterBlock：识别头部 FM', () => {
  const src = `${FM}\n# 标题\n正文`;
  assert.equal(frontmatterEndOffset(src), FM.length + 1); // FM + 换行
  assert.equal(frontmatterEndOffset('没有 FM'), 0);
  assert.equal(isFrontmatterBlock(FM), true);
  assert.equal(isFrontmatterBlock('# 标题'), false);
});

test('insertAttachmentSnippet edit：偏移落在 FM 内时改插到 FM 之后', () => {
  const src = `${FM}\n# 标题\n\n## 附件`;
  // 旧 bug：live 把块内 caret=5 当全文偏移 → 插进 "board" 中间
  const { body } = insertAttachmentSnippet(src, IMG, { mode: 'edit', insertAt: 5 });
  const fm = parseFrontmatter(body);
  assert.equal(fm.board, 'b_1', 'board 键不被撕碎');
  assert.equal(fm.project, 'local/x');
  assert.ok(!Object.keys(fm).includes('d'), '不产生残留单字母键');
  assert.match(body, new RegExp(`!\\[shot\\.png\\]\\(${FID}\\)`));
  assert.ok(body.indexOf(`![shot.png](${FID})`) >= frontmatterEndOffset(body));
});

test('insertAttachmentSnippet live：块内 caret 插进内容块，不碰 FM', () => {
  const src = `${FM}\n# 标题\n\n参考材料：如附件\n\n## 附件`;
  const live = liveBodyBlocks(src);
  // live[0]=FM, live[1]=「参考材料…」, …
  const contentIdx = live.findIndex((b) => /参考材料/.test(b));
  assert.ok(contentIdx > 0, '内容块在 FM 之后');
  const caret = live[contentIdx].indexOf('如附件');
  const { body } = insertAttachmentSnippet(src, IMG, {
    mode: 'live',
    focusIndex: contentIdx,
    caretInBlock: caret,
  });
  assert.equal(parseFrontmatter(body).board, 'b_1');
  assert.match(body, /参考材料：/);
  assert.match(body, new RegExp(`!\\[shot\\.png\\]\\(${FID}\\)`));
  assert.match(body, /如附件/);
  // 嵌入夹在「参考材料」与「如附件」之间，且必须在 FM 之外
  const bare = body.slice(frontmatterEndOffset(body));
  assert.match(bare, new RegExp(FID));
  assert.ok(
    bare.indexOf('参考材料') < bare.indexOf(FID) && bare.indexOf(FID) < bare.indexOf('如附件'),
    '嵌入落在光标处（参考材料…如附件）'
  );
});

test('insertAttachmentSnippet live：焦点在 FM 块上时改插到下一块', () => {
  const src = `${FM}\n# 标题\n\n正文段`;
  const { body } = insertAttachmentSnippet(src, IMG, {
    mode: 'live',
    focusIndex: 0, // FM
    caretInBlock: 3,
  });
  assert.equal(parseFrontmatter(body).board, 'b_1', 'FM 完好');
  assert.match(body, new RegExp(`!\\[shot\\.png\\]\\(${FID}\\)`));
  assert.ok(!body.slice(0, frontmatterEndOffset(body)).includes(FID), 'fileId 不在 FM 内');
});

test('insertAttachmentSnippet live：无焦点时追加到文末', () => {
  const src = `${FM}\n# 标题\n\n正文`;
  const { body } = insertAttachmentSnippet(src, IMG, { mode: 'live', focusIndex: null });
  assert.equal(parseFrontmatter(body).board, 'b_1');
  assert.ok(body.trimEnd().endsWith(`![shot.png](${FID})`) || body.includes(FID));
});

// 幻影空块清洗（#92「每次打开多一段空白」）：块编辑器把空块编码成 ZWSP 行
// 落盘，落库正文里它只会渲染成一块莫名空白。保存组合时剥掉；纯空白块
// （ZWSP+空格，#21 保空格）是用户敲的内容，保留。
const ZWSP = '​';
test('stripPhantomEmptyLines：剥 ZWSP 独占行并收敛连续空行', () => {
  assert.equal(stripPhantomEmptyLines(`a\n\n${ZWSP}\n\nb`), 'a\n\nb');
  assert.equal(stripPhantomEmptyLines(`${ZWSP}\na`), 'a');
  assert.equal(stripPhantomEmptyLines(`a\n${ZWSP}\n\n\n${ZWSP}\n\nb`), 'a\n\nb');
  assert.equal(stripPhantomEmptyLines(`a\n\n${ZWSP}\n\nb\n\n`), 'a\n\nb\n\n', '只剥 ZWSP 行，不动尾部空行');
});
test('stripPhantomEmptyLines：纯空白块（ZWSP+空格）保留', () => {
  assert.equal(stripPhantomEmptyLines(`a\n\n${ZWSP} \n\nb`), `a\n\n${ZWSP} \n\nb`);
});
test('stripPhantomEmptyLines：无 ZWSP 时原样返回', () => {
  const src = 'a\n\n\n\nb';
  assert.equal(stripPhantomEmptyLines(src), src);
});
