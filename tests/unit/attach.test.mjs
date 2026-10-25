// 类 markdown 附件嵌入的解析/生成（modules/todo/attach.js）。
//
// 这份实现是 Node 与浏览器**共用**的，任何一侧的改动都会影响另一侧，
// 所以边界必须钉死：哪些算嵌入、哪些必须原样留在纯文本里。
//
// 最要紧的一条：**不能把普通链接当成附件**。误判的后果不是报错，
// 而是「预览 404 + 同步时白跑一趟网络」，还很难看出是解析的锅。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentIds, attachmentRefs, embedMarkdown, looksLikeFileId, parseEmbeds, stripEmbeds,
} from '../../src/modules/todo/attach.js';

const ID = 'a'.repeat(32);
const ID_DOCX = `${'b'.repeat(32)}.docx`;

test('looksLikeFileId：只认后端那种 hex（可带扩展名）', () => {
  assert.equal(looksLikeFileId(ID), true);
  assert.equal(looksLikeFileId(ID_DOCX), true);
  assert.equal(looksLikeFileId(ID.toUpperCase()), true, 'hex 大小写都该认');

  assert.equal(looksLikeFileId('https://example.com/a.png'), false);
  assert.equal(looksLikeFileId('./报表.md'), false, '相对路径不是附件');
  assert.equal(looksLikeFileId('/files/abc'), false, '站点路径不是附件');
  assert.equal(looksLikeFileId('abc'), false);
  assert.equal(looksLikeFileId(''), false);
  assert.equal(looksLikeFileId('a'.repeat(15)), false, '不足 16 位 hex 不是附件 id');
  assert.equal(looksLikeFileId('a'.repeat(16)), true, '16 位 hex 起视为合法');
});

test('parseEmbeds：切开文本与嵌入，顺序保持不变', () => {
  const text = `看这个 ![图](${ID}) 还有 [报告](${ID_DOCX})`;
  const segs = parseEmbeds(text);
  assert.deepEqual(segs.map((s) => s.type), ['text', 'image', 'text', 'file']);
  assert.equal(segs[1].id, ID);
  assert.equal(segs[1].alt, '图');
  assert.equal(segs[3].id, ID_DOCX);
  assert.equal(segs[3].alt, '报告');
  // 纯文本片段原样保留（渲染端只做嵌入，不做 markdown）
  assert.match(segs[0].value, /^看这个 /);
});

test('parseEmbeds：普通 markdown 链接一律不动', () => {
  const text = '见 [文档](https://example.com/x.md) 与 [本地](./a.md)';
  const segs = parseEmbeds(text);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'text');
  assert.equal(segs[0].value, text);
});

test('parseEmbeds：没有嵌入时返回单段文本，空串返回空数组', () => {
  assert.deepEqual(parseEmbeds('just text'), [{ type: 'text', value: 'just text' }]);
  assert.deepEqual(parseEmbeds(''), []);
  assert.deepEqual(parseEmbeds(null), []);
});

test('attachmentIds：去重且保序', () => {
  const text = `![a](${ID}) 文字 [b](${ID}) [c](${ID_DOCX})`;
  assert.deepEqual(attachmentIds(text), [ID, ID_DOCX]);
  assert.deepEqual(attachmentIds('没有附件'), []);
});

test('attachmentRefs：同一 id 取首次出现的说明文字（它会被当本地文件名）', () => {
  const refs = attachmentRefs(`![季度报表.docx](${ID_DOCX}) 后来又叫 ![](${ID_DOCX})`);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].alt, '季度报表.docx');
  assert.equal(refs[0].kind, 'image');
});

test('embedMarkdown：按类型给图片/链接语法，并清掉会破坏语法的方括号', () => {
  assert.equal(embedMarkdown({ name: '图', id: ID, kind: 'image' }), `![图](${ID})`);
  assert.equal(embedMarkdown({ name: '报告.docx', id: ID_DOCX, kind: 'file' }), `[报告.docx](${ID_DOCX})`);
  assert.equal(embedMarkdown({ name: 'a[b]c', id: ID, kind: 'file' }), `[abc](${ID})`);
  assert.equal(embedMarkdown({ name: 'x', id: '', kind: 'file' }), '');
  assert.equal(embedMarkdown({ id: ID, kind: 'file' }), `[${ID}](${ID})`, '没名字就用 id 当文字');
});

test('stripEmbeds：去掉嵌入只留文字（列表摘要用）', () => {
  const text = `修一下 logo ![图](${ID})  顺便更新文案`;
  assert.equal(stripEmbeds(text), '修一下 logo 顺便更新文案');
});

test('往返：生成的嵌入能被自己解析回来', () => {
  const md = embedMarkdown({ name: '架构图.png', id: ID, kind: 'image' });
  const refs = attachmentRefs(`任务 A ${md}`);
  assert.deepEqual(refs, [{ id: ID, kind: 'image', alt: '架构图.png' }]);
});
