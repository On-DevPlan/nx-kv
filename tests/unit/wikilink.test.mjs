// 双链纯函数（core/wikilink.js）的单元测试：解析、归一、解析顺序（地址 > 唯一文件名 > 多候选）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiLinks, normalizeWikiTarget, resolveWikiLink } from '../../src/shared/wikilink.js';

test('parseWikiLinks：目标、别名、忽略空目标', () => {
  const links = parseWikiLinks('看 [[nx-kv]] 和 [[group/nx系列/github.com/me/x|这篇]]，不是 [单链](x)。');
  assert.deepEqual(links, [
    { target: 'nx-kv', label: 'nx-kv' },
    { target: 'group/nx系列/github.com/me/x', label: '这篇' },
  ]);
  assert.deepEqual(parseWikiLinks('[[]] 与 [[ ]]'), []);
});

test('normalizeWikiTarget：剥 .md 尾、压空白、小写', () => {
  assert.equal(normalizeWikiTarget('  Nx-KV.MD '), 'nx-kv');
  assert.equal(normalizeWikiTarget('group/前端/GitHub.COM/Me/X'), 'group/前端/github.com/me/x');
  assert.equal(normalizeWikiTarget(''), '');
});

test('resolveWikiLink：rel 精确命中优先于文件名', () => {
  const index = [
    { docId: 'rel:repo/a/b.md', name: 'b', rel: 'repo/a/b.md' },
    { docId: 'rel:repo/c/b.md', name: 'b', rel: 'repo/c/b.md' },
  ];
  assert.deepEqual(resolveWikiLink('repo/a/b.md', index), { docId: 'rel:repo/a/b.md' });
  // 目标不带 .md 也能按路径命中（归一时剥尾缀）
  assert.deepEqual(resolveWikiLink('repo/a/b', index), { docId: 'rel:repo/a/b.md' });
});

test('resolveWikiLink：文件名唯一命中；多命中返回候选不猜；未命中 null', () => {
  const single = [{ docId: 'rel:repo/x.md', name: 'x', rel: 'repo/x.md' }];
  assert.deepEqual(resolveWikiLink('X.md', single), { docId: 'rel:repo/x.md' });

  const multi = [
    { docId: 'rel:repo/a/b.md', name: 'b', rel: 'repo/a/b.md' },
    { docId: 'rel:repo/c/b.md', name: 'b', rel: 'repo/c/b.md' },
  ];
  assert.deepEqual(resolveWikiLink('b', multi), { candidates: ['rel:repo/a/b.md', 'rel:repo/c/b.md'] });
  assert.equal(resolveWikiLink('不存在', single), null);
  assert.equal(resolveWikiLink('x', []), null);
});

test('WIKI_LINK_RE 是全局正则——parseWikiLinks 可重复调用不受 lastIndex 影响', () => {
  parseWikiLinks('[[a]] [[b]]');
  assert.deepEqual(parseWikiLinks('[[a]] [[b]]').length, 2);
});
