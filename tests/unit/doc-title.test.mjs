// #168：文档标题口径——标题 = 正文**首行**的 `# 标题`。
//
//   · 正文第一行是普通文字 → **不是**标题（#168 bug 2：正文第一行顶替标题）；
//   · 正文中间的 # 行 → 不是标题（标题只认首行）；
//   · 编辑标题 → 改写首行（首行不是 # 就补到文首），frontmatter 保留。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docTitleFromMd, setDocTitleInMd } from '../../src/shared/doc-title.js';

test('docTitleFromMd：只认正文首行的 # 标题', () => {
  assert.equal(docTitleFromMd('# 使用指南\n\n正文'), '使用指南');
  assert.equal(docTitleFromMd('第一行是正文\n# 标题在第二行'), '', '正文第一行不是标题 → 空');
  assert.equal(docTitleFromMd('# 标题\n# 第二个标题'), '标题', '只认首行');
  assert.equal(docTitleFromMd('\n\n# 空行后的标题'), '空行后的标题');
  assert.equal(docTitleFromMd(''), '');
  assert.equal(docTitleFromMd('普通文字'), '');
});

test('docTitleFromMd：frontmatter 不算正文（标题取 frontmatter 之后的首行）', () => {
  const body = '---\nboard: group/x\n---\n# 真正的标题\n\n正文';
  assert.equal(docTitleFromMd(body), '真正的标题');
  assert.equal(docTitleFromMd('---\nboard: group/x\n---\n普通文字'), '');
});

test('setDocTitleInMd：首行是 # → 就地替换；否则补到文首', () => {
  assert.equal(setDocTitleInMd('# 旧标题\n\n正文', '新标题'), '# 新标题\n\n正文');
  assert.equal(setDocTitleInMd('普通文字\n\n正文', '新标题'), '# 新标题\n普通文字\n\n正文');
  assert.equal(setDocTitleInMd('', '新标题'), '# 新标题\n');
  assert.equal(setDocTitleInMd('普通文字', ''), '# 未命名文档\n普通文字');
});

test('setDocTitleInMd：frontmatter 原样保留，标题行落在它后面', () => {
  const body = '---\nboard: group/x\n---\n# 旧标题\n\n正文';
  const out = setDocTitleInMd(body, '新标题');
  assert.equal(out, '---\nboard: group/x\n---\n# 新标题\n\n正文');
  assert.equal(docTitleFromMd(out), '新标题');
});
