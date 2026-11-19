// #243 语法补齐：段落合并 / 标题 4–6 / 列表嵌套与续行 / 引用内块级 /
// 高亮 / 脚注 / 引用式链接 / 反斜杠转义 / 尖括号自动链接 / 代码块语言 / 表格转义。
//
// 这些都是**渲染语义**断言（纯函数），与 md-syntax-model.test.mjs（#239 的表格/
// 公式/强调）互补：那份钉「新增语法能渲染」，这份钉「补齐后与 CommonMark 的
// 边界一致」，并覆盖几处曾被误伤的回归（代码里的星号、callout 的 <br> 形态）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownHtml } from '../../src/web/frontend/modules/md/md-render.js';

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
