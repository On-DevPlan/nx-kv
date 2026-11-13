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

test('resolveWikiLink：外部文档按 path 精确命中优先于文件名（path 与目标同口径）', () => {
  // v8：WikiIndexEntry 没有 rel；外部文档只有 path（比较前统一正斜杠 + 小写）
  const index = [
    { docId: 'ref:ref_1111111111111111', name: 'b', path: 'D:/Vault/a/b' },
    { docId: 'ref:ref_2222222222222222', name: 'b', path: 'D:/Vault/c/b' },
  ];
  assert.deepEqual(resolveWikiLink('d:\\vault\\A\\b', index), { docId: 'ref:ref_1111111111111111' });
});

test('resolveWikiLink：文件名唯一命中；多命中返回候选不猜；未命中 null', () => {
  const single = [{ docId: 'ref:ref_3333333333333333', name: 'x' }];
  assert.deepEqual(resolveWikiLink('X.md', single), { docId: 'ref:ref_3333333333333333' });

  const multi = [
    { docId: 'ref:ref_1111111111111111', name: 'b' },
    { docId: 'ref:ref_2222222222222222', name: 'b' },
  ];
  assert.deepEqual(resolveWikiLink('b', multi), {
    candidates: ['ref:ref_1111111111111111', 'ref:ref_2222222222222222'],
  });
  assert.equal(resolveWikiLink('不存在', single), null);
  assert.equal(resolveWikiLink('x', []), null);
});

test('WIKI_LINK_RE 是全局正则——parseWikiLinks 可重复调用不受 lastIndex 影响', () => {
  parseWikiLinks('[[a]] [[b]]');
  assert.deepEqual(parseWikiLinks('[[a]] [[b]]').length, 2);
});
