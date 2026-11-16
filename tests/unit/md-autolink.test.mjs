// #142：md 渲染器里的 HTTP 链接——markdown 语法 `[文本](https://…)` 与裸 URL
// 都要渲染成可点的 <a class="md-link" target="_blank">；代码里的 URL 保持原样。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownHtml } from '../../src/web/frontend/modules/md/md-parse.js';

test('裸 URL → 可点外链（新标签打开，带 noopener）', () => {
  const html = renderMarkdownHtml('见 https://example.com/a?b=1 这篇');
  assert.ok(html.includes('<a class="md-link" href="https://example.com/a?b=1"'), '裸地址要变成链接');
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('>https://example.com/a?b=1</a>'), '显示名就是地址本身');
  assert.ok(html.includes('见 ') && html.includes(' 这篇'), '前后普通文字不动');
});

test('markdown 语法 [文本](https://…) → 用文本当显示名', () => {
  const html = renderMarkdownHtml('参考 [nx-kv 文档](https://github.com/on-devplan/nx-kv) 看看');
  assert.ok(html.includes('href="https://github.com/on-devplan/nx-kv"'));
  assert.ok(html.includes('>nx-kv 文档</a>'), '显示名是方括号里的文本');
  assert.equal(html.includes('[nx-kv 文档]('), false, '不再残留 markdown 原文');
});

test('句末标点不算地址：`见 https://x.com/a.` 的句号留在链接外', () => {
  const html = renderMarkdownHtml('见 https://x.com/a。');
  assert.ok(html.includes('href="https://x.com/a"'));
  assert.ok(html.includes('</a>。'), '中文句号落在链接之后');
});

test('行内 code 与 fenced code 里的 URL 不变成链接', () => {
  const inline = renderMarkdownHtml('命令：`curl https://x.com/a`');
  assert.equal(inline.includes('md-link'), false, '行内 code 内不自动链接');
  const fenced = renderMarkdownHtml(['```', 'curl https://x.com/a', '```'].join('\n'));
  assert.equal(fenced.includes('md-link'), false, 'fenced code 内不自动链接');
});

test('已在链接里的地址不会被再包一层（href 与 <a> 内部跳过）', () => {
  const html = renderMarkdownHtml('[a](https://x.com/1) 与 https://x.com/2');
  assert.equal(html.match(/class="md-link"/g).length, 2, '两条链接，各一次');
  assert.equal(html.includes('href="https://x.com/1" target="_blank" rel="noopener noreferrer" title="https://x.com/1">a</a>'), true);
});

test('http 也支持（不只 https）；非 http 协议不自动识别', () => {
  const html = renderMarkdownHtml('http://127.0.0.1:7877/#/repos 与 ftp://x.com/a 与 ./docs/a.md');
  assert.ok(html.includes('href="http://127.0.0.1:7877/#/repos"'));
  assert.equal(html.includes('ftp://'), true);
  assert.equal(html.includes('href="ftp://'), false, 'ftp 不识别');
  assert.equal(html.includes('./docs/a.md'), true, '相对路径原样');
});

test('标题 / 引用 / 列表里的 URL 同样可点（inline 全覆盖）', () => {
  const src = ['## 见 https://a.com/1', '', '> 引用 https://a.com/2', '', '- 列表 https://a.com/3'].join('\n');
  const html = renderMarkdownHtml(src);
  for (const u of ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']) {
    assert.ok(html.includes(`href="${u}"`), `标题/引用/列表里的 ${u} 要可点`);
  }
});

test('双链与内链不受影响（仍走 data-wl / data-nxkv）', () => {
  const html = renderMarkdownHtml('[[某文档]] 与 [内链](nxkv://ref/ref_0123456789abcdef) 与 https://x.com/9');
  assert.ok(html.includes('data-wl="某文档"'), '双链还在');
  assert.ok(html.includes('data-nxkv="nxkv://ref/ref_0123456789abcdef"'), 'nxkv 内链还在');
  assert.equal(html.match(/class="md-link"/g).length, 1, '只有那一条外链');
});

test('XSS：地址里的引号/尖括号被转义，不会逃出属性', () => {
  const html = renderMarkdownHtml('https://x.com/"><script>alert(1)</script>');
  assert.equal(html.includes('<script>'), false, '不允许注入标签');
  assert.ok(html.includes('&quot;'), '引号已转义');
});
