// doc-store 对外的快照契约（回归护栏）
//
// 历史 bug：useDocs() 曾经把模块内部的包装对象 `{ docs: {...} }` 透出去，
// 而调用方（page-panel）按平铺 map 取 `docs[docId]` —— 永远 undefined，
// 表现为任务详细页永久停在「载入中…」，且没有任何报错。改动极隐蔽，
// 所以这里同时锁「形状」和「写入后可见」两件事。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  docsSnapshot,
  docIdOf,
  dropDoc,
  getDoc,
  promoteDoc,
  saveDoc,
  scopeOf,
} from '../../src/web/frontend/modules/md-workspace/doc-store.js';

test('docsSnapshot 是扁平的 docId → doc 映射，不带外层 docs 壳', () => {
  const id = docIdOf('k1', '1');
  getDoc(id, { title: 'T', body: 'B' });
  const m = docsSnapshot();
  assert.equal(m[id] && m[id].title, 'T');
  assert.equal(m[id] && m[id].body, 'B');
  // 关键：不能再透出内部包装
  assert.equal(m.docs, undefined);
  assert.equal(typeof m[Symbol.iterator], 'undefined');
});

test('getDoc 已有文档时不覆盖（首开种入只发生一次）', () => {
  const id = docIdOf('k2', '7');
  getDoc(id, { title: '首开', body: '正文' });
  saveDoc(id, { body: '改过了' });
  getDoc(id, { title: '不该生效', body: '不该生效' });
  const d = docsSnapshot()[id];
  assert.equal(d.title, '首开');
  assert.equal(d.body, '改过了');
});

test('saveDoc 产生新快照引用（useSyncExternalStore 靠它触发重渲染）', () => {
  const id = docIdOf('k3', '9');
  getDoc(id, { title: 'x', body: 'y' });
  const before = docsSnapshot();
  saveDoc(id, { body: 'z' });
  const after = docsSnapshot();
  assert.notEqual(before, after);
  assert.equal(after[id].body, 'z');
});

test('promoteDoc 换身份：旧 id 消失、新 id 拿到内容', () => {
  const from = docIdOf('k4', 'draft-1');
  const to = docIdOf('k4', '42');
  getDoc(from, { title: '草稿', body: '内容' });
  promoteDoc(from, to, { title: '转正' });
  const m = docsSnapshot();
  assert.equal(m[from], undefined);
  assert.equal(m[to].title, '转正');
  assert.equal(m[to].body, '内容');
});

test('scopeOf 缺省落到全局池', () => {
  assert.equal(scopeOf(''), scopeOf(undefined));
  assert.equal(scopeOf('dirA'), 'dirA');
});

test('dropDoc 只删自己那一条', () => {
  const a = docIdOf('k5', '1');
  const b = docIdOf('k5', '2');
  getDoc(a, { title: 'a' });
  getDoc(b, { title: 'b' });
  dropDoc(a);
  const m = docsSnapshot();
  assert.equal(m[a], undefined);
  assert.equal(m[b].title, 'b');
});
