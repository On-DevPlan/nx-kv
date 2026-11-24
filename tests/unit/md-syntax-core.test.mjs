import { test } from 'node:test';
import assert from 'node:assert/strict';
// renderMarkdownHtml 在 md-parse 里 re-export 自 md-render（同一函数）；统一走 md-render
import { renderMarkdownHtml } from '../../src/web/frontend/modules/md/md-render.js';
import {
  splitMdBlocks,
} from '../../src/web/frontend/modules/md/md-parse.js';
const r = (s) => renderMarkdownHtml(s);

test('段落：连续非空行合成一个 <p>，行间 <br>；空行才分段', () => {
  assert.equal(r('第一行\n第二行'), '<p>第一行<br>第二行</p>');
  assert.equal(r('第一行\n第二行\n\n第二段'), '<p>第一行<br>第二行</p><p>第二段</p>');
});

test('段落合并不吞块级：文字后紧跟列表仍是两段', () => {
  const html = r('说明\n- 甲\n- 乙');
  assert.ok(html.startsWith('<p>说明</p><ul>'), html);
});

test('标题：h4–h6 渲染成对应标签（此前只到 h3，更深层级掉成段落）', () => {
  assert.equal(r('#### 四级'), '<h4 id="四级">四级</h4>');
  assert.equal(r('##### 五级'), '<h5 id="五级">五级</h5>');
  assert.equal(r('###### 六级'), '<h6 id="六级">六级</h6>');
});

test('无序列表：缩进子项成为嵌套 <ul>（此前整段子项被丢弃）', () => {
  assert.equal(
    r('- 甲\n  - 甲1\n  - 甲2\n- 乙'),
    '<ul><li>甲<ul><li>甲1</li><li>甲2</li></ul></li><li>乙</li></ul>',
  );
});

test('无序列表：`*` / `+` 标记也认；`* * *` 仍归分隔线', () => {
  assert.equal(r('* 甲\n* 乙'), '<ul><li>甲</li><li>乙</li></ul>');
  assert.equal(r('+ 甲'), '<ul><li>甲</li></ul>');
  assert.equal(r('* * *'), '<hr class="md-divider">');
});

test('项内续行：缩进更深的普通行并入当前项，用 <br> 连接', () => {
  assert.equal(r('- 第一行\n  接着写\n- 第二项'), '<ul><li>第一行<br>接着写</li><li>第二项</li></ul>');
});

test('有序列表：嵌套与 start 属性（3. 起头不从 1 重排）', () => {
  assert.equal(r('3. 三\n4. 四'), '<ol start="3"><li>三</li><li>四</li></ol>');
  assert.equal(r('1. 一\n   1. 一a\n2. 二'), '<ol><li>一<ol><li>一a</li></ol></li><li>二</li></ol>');
  assert.equal(r('1) 括号式'), '<ol><li>括号式</li></ol>');
});

test('引用内块级：列表走递归渲染，不再是纯文本', () => {
  const html = r('> 引言\n> - a\n> - b');
  assert.ok(html.includes('<blockquote><p>引言</p><ul><li>a</li><li>b</li></ul></blockquote>'), html);
});

test('callout 纯文本正文仍按 <br> 拼接（既有观感不回退）', () => {
  const html = r('> [!note] 标题\n> 第一行\n> 第二行');
  assert.ok(html.includes('第一行<br>第二行'), html);
});

test('高亮 ==x== → <mark>；代码里的 ==x== 原样', () => {
  assert.equal(r('这是 ==重点== 内容'), '<p>这是 <mark>重点</mark> 内容</p>');
  assert.ok(r('`a==b==c`').includes('<code>a==b==c</code>'));
});

test('脚注：引用点上标编号 + 文末列表（含缩进续行）', () => {
  const html = r('正文[^n1]。\n\n[^n1]: 说明第一行，\n  续行补充。');
  assert.ok(html.includes('<sup class="md-fn-ref"><a href="#md-fn-1" id="md-fnref-1">1</a></sup>'), html);
  assert.ok(html.includes('<li id="md-fn-1">说明第一行，<br>续行补充。'), html);
  assert.ok(html.startsWith('<p>正文'), '定义行不该留在正文里');
  assert.ok(!html.includes('[^n1]:'), '定义行必须被抽走');
});

test('脚注：未定义的 `[^x]` 原样显示，不生成空引用', () => {
  const html = r('文本 [^缺] 结束');
  assert.ok(html.includes('[^缺]'), html);
  assert.ok(!html.includes('md-fn-ref'), html);
});

test('引用式链接：[文字][标签] 与 [文字][] 都展开成外链', () => {
  const html = r('见 [文档][d1] 与 [站点][]。\n\n[d1]: https://example.com/a\n[站点]: https://example.org');
  assert.ok(html.includes('href="https://example.com/a"') && html.includes('>文档</a>'), html);
  assert.ok(html.includes('href="https://example.org"') && html.includes('>站点</a>'), html);
  assert.ok(!html.includes('[d1]:'), '定义行必须被抽走');
});

test('引用式链接：标签未定义时保留原文；双链不被误吃', () => {
  assert.ok(r('[文字][没定义]').includes('[文字][没定义]'));
  assert.ok(r('[[某文档|显示]]').includes('data-wl="某文档"'));
});

test('转义：\\* \\_ \\# 按字面显示，且不再开启强调', () => {
  assert.equal(r('\\*不是斜体\\*'), '<p>*不是斜体*</p>');
  assert.equal(r('\\# 不是标题'), '<p># 不是标题</p>');
  assert.equal(r('\\*字面\\* 与 *真斜体*'), '<p>*字面* 与 <em>真斜体</em></p>');
});

test('转义：代码片段里的反斜杠是内容，不被消费', () => {
  assert.ok(r('`\\*`').includes('<code>\\*</code>'));
});

test('尖括号自动链接：<https://…> → 外链，query 的 & 正确转义', () => {
  const html = r('访问 <https://example.com/x?a=1&b=2> 看看');
  assert.ok(html.includes('href="https://example.com/x?a=1&amp;b=2"'), html);
  assert.ok(html.includes('target="_blank"'), html);
});

test('代码块保留语言标记（data-lang），正文不做行内渲染', () => {
  const html = r('```js\nconst a = "**x**";\n```');
  assert.ok(html.includes('data-lang="js"'), html);
  assert.ok(html.includes('**x**'), '代码内容不该被加粗');
});

test('表格：单元格里的 \\| 是字面竖线，不切格', () => {
  const html = r('| a | b |\n| --- | --- |\n| x \\| y | z |');
  assert.ok(html.includes('<td>x | y</td>'), html);
  assert.ok(html.includes('<td>z</td>'), html);
});

test('回归：代码里的星号不再被斜体规则误伤', () => {
  assert.ok(r('代码 `a*b*c` 不该斜体').includes('<code>a*b*c</code>'));
  assert.ok(!r('代码 `a*b*c`').includes('<em>'));
});

// ════ md-syntax-extra.test.mjs（#200 合并入本文件）════
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

