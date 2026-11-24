// MD 块模型（split/join、空块编码、附件片段插入）。#197 起正文无 frontmatter 头，
// 相关的 FM 块识别/落点测试随功能一起删除。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitMdBlocks,
  joinMdBlocks,
  renderMarkdownHtml,
  normalizeBlockText,
  insertAttachmentSnippet,
  liveBodyBlocks,
  stripPhantomEmptyLines,
} from '../../src/web/frontend/modules/md/md-parse.js';

// MD 块模型（split/join、空块编码、附件片段插入）。#197 起正文无 frontmatter 头，
// 相关的 FM 块识别/落点测试随功能一起删除。
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


const FID = 'a'.repeat(32);
const IMG = `\n![shot.png](${FID})\n`;

test('insertAttachmentSnippet edit：按全文偏移插入', () => {
  const src = '# 标题\n\n## 附件';
  const { body } = insertAttachmentSnippet(src, IMG, { mode: 'edit', insertAt: src.length });
  assert.match(body, new RegExp(`!\\[shot\\.png\\]\\(${FID}\\)`));
  assert.ok(body.trimEnd().endsWith(`![shot.png](${FID})`));
});

test('insertAttachmentSnippet live：块内 caret 插进内容块', () => {
  const src = '# 标题\n\n参考材料：如附件\n\n## 附件';
  const live = liveBodyBlocks(src);
  const contentIdx = live.findIndex((b) => /参考材料/.test(b));
  const caret = live[contentIdx].indexOf('如附件');
  const { body } = insertAttachmentSnippet(src, IMG, {
    mode: 'live',
    focusIndex: contentIdx,
    caretInBlock: caret,
  });
  assert.match(body, /参考材料：/);
  assert.match(body, new RegExp(`!\\[shot\\.png\\]\\(${FID}\\)`));
  assert.match(body, /如附件/);
  // 嵌入夹在「参考材料」与「如附件」之间（落在光标处）
  assert.ok(
    body.indexOf('参考材料') < body.indexOf(FID) && body.indexOf(FID) < body.indexOf('如附件'),
    '嵌入落在光标处（参考材料…如附件）'
  );
});

test('insertAttachmentSnippet live：无焦点时追加到文末', () => {
  const src = '# 标题\n\n正文';
  const { body } = insertAttachmentSnippet(src, IMG, { mode: 'live', focusIndex: null });
  assert.ok(body.trimEnd().endsWith(`![shot.png](${FID})`) || body.includes(FID));
});


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

// ── 文件附件 chip 去重（#118：内联 [名](fileId) 已渲染成 a.md-att，
//    整表再拼 chip 就是重复；实时面板逐块渲染时更是「每一行都显示」）──
const FILE_ATT = [{ type: 'file', id: FID, name: '测试文档.md', size: '19 B' }];

test('renderMarkdownHtml：正文已内联引用的文件附件不再拼 chip（#118）', () => {
  const html = renderMarkdownHtml(`正文\n[测试文档.md](${FID})`, FILE_ATT);
  assert.match(html, /<a class="md-att"[^>]*>测试文档\.md<\/a>/, '内联链接照常');
  assert.doesNotMatch(html, /mdw-attach-chip/, '不再追加整表 chip');
});

test('renderMarkdownHtml：未内联引用的文件附件仍出 chip（v1 老数据兜底）', () => {
  const html = renderMarkdownHtml('正文段', FILE_ATT);
  assert.match(html, /mdw-attach-chip/);
  assert.match(html, /测试文档\.md/);
  assert.ok(!html.includes('md-att'), '正文没有链接');
});

// #183：绑定类附件（ref / task / url）不是正文里的东西，chip 兜底必须跳过它们。
// 此前它们也进 filter，块编辑器逐块渲染 → 每个块底部都挂一条同名 chip。
const REF_ATT = [{ kind: 'ref', id: 'att_ref_x', name: '设计笔记', role: 'attach', targetKey: 'ref_y' }];
test('renderMarkdownHtml：ref 绑定不再吐 chip（块编辑器逐块渲染会变成满屏同名）', () => {
  const html = renderMarkdownHtml('正文段', REF_ATT);
  assert.doesNotMatch(html, /mdw-attach-chip/);
  assert.equal(html, '<p>正文段</p>');
});
test('renderMarkdownHtml：task / url 绑定同样不吐 chip', () => {
  const html = renderMarkdownHtml('正文段', [
    { kind: 'task', id: 'att_task_x', name: '#183 任务', role: 'attach' },
    { kind: 'url', id: 'att_url_x', name: 'https://example.com', role: 'attach' },
  ]);
  assert.doesNotMatch(html, /mdw-attach-chip/);
});
