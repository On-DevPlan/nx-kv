// 文档派生摘要（modules/docs/seed.js）的单元测试。
//
// v8 起 seed.js 只剩 summaryFromMd：不再有约定路径 / 迁移种子 / 摘要回写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryFromMd } from '../../src/modules/docs/seed.js';

test('summaryFromMd：frontmatter description 优先，否则首个正文行，截 120 字', () => {
  assert.equal(summaryFromMd('---\ndescription: 元描述\n---\n\n# 标题\n\n正文在这里'), '元描述');
  assert.equal(summaryFromMd('# 标题\n\n> 引用不算\n\n正文第一行'), '正文第一行');
  assert.equal(summaryFromMd('# 只有标题'), '');
  const long = 'x'.repeat(200);
  assert.equal(summaryFromMd(long).length, 120);
});
