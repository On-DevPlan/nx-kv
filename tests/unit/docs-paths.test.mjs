// docs 域地址权威（modules/docs/paths.js → docref）的单元测试。
//
// v8 起没有「自有树相对路径」：ref 的地址就是 refs.id（ref_<16hex>），
// 外部目录里的裸文件才用 path:<绝对路径>。这里只钉 docId 前缀与 DocRef 形状。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_REFERENCE_DIR,
  assertRefId,
  assertDocRef,
  sanitizeDocRef,
  ownDocId,
  extDocId,
} from '../../src/modules/docs/paths.js';

test('assertRefId：只认 ref_<16hex>，统一小写', () => {
  assert.equal(assertRefId('ref_0123456789abcdef'), 'ref_0123456789abcdef');
  assert.equal(assertRefId('REF_0123456789ABCDEF'), 'ref_0123456789abcdef');
  assert.equal(assertRefId(' ref_0123456789abcdef '), 'ref_0123456789abcdef');
  assert.throws(() => assertRefId('notes/a.md'), /refId/);
  assert.throws(() => assertRefId('ref_123'), /refId/);
  assert.throws(() => assertRefId(''), /refId/);
});

test('assertDocRef：只有 { ref }，非法形状抛 badInput', () => {
  assert.deepEqual(assertDocRef({ ref: 'ref_0123456789abcdef' }), { ref: 'ref_0123456789abcdef' });
  assert.throws(() => assertDocRef({}), /不能为空/);
  assert.throws(() => assertDocRef({ rel: 'repo/a.md' }), /refId|不能为空/);
  assert.throws(() => assertDocRef({ path: 'D:/vault/x.md' }), /refId|不能为空/);
  assert.throws(() => assertDocRef('ref_0123456789abcdef'), /必须是/);
  assert.throws(() => assertDocRef(null), /必须是/);
});

test('sanitizeDocRef：宽松版对脏数据返回 null，好数据原样归一', () => {
  assert.deepEqual(sanitizeDocRef({ ref: 'REF_0123456789ABCDEF' }), { ref: 'ref_0123456789abcdef' });
  assert.equal(sanitizeDocRef({ rel: 'repo/a.md' }), null);
  assert.equal(sanitizeDocRef({ path: 'D:/vault/x.md' }), null);
  assert.equal(sanitizeDocRef(undefined), null);
  assert.equal(sanitizeDocRef([]), null);
});

test('docId：ref 统一 ref:<refId>，外部裸文件必须 path: 前缀', () => {
  assert.equal(ownDocId('ref_0123456789abcdef'), 'ref:ref_0123456789abcdef');
  assert.equal(extDocId('D:/vault/x.md'), 'path:D:/vault/x.md');
});

test('DOC_REFERENCE_DIR 仍是 reference（外部目录里的参考说明子目录）', () => {
  assert.equal(DOC_REFERENCE_DIR, 'reference');
});
