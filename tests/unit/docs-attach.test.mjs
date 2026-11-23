// 文档侧附件区：docs attach --no-embed 只写 ref_attach，不碰正文；
// docs attachments 能列出附件区条目；detach 区分只解除与连字节删除。
//
// v8：文档地址一律 refId（先 ensureDocRef 建行，再 writeOwnDoc 写正文）。
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-docatt-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_DB = join(sb, 'nxkv.db');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');

const store = await import('../../src/modules/docs/store.js');
const docsMod = (await import('../../src/modules/docs/index.js')).default;
const { ensureDocRef } = await import('../../src/core/attachmentdb.js');
const { getDb, closeDb } = await import('../../src/core/db/index.js');

const action = (id) => docsMod.actions.find((a) => a.id === id);

const docId = (refId) => 'ref:' + refId;

async function seedDoc(refId, body) {
  ensureDocRef(getDb(), { ref: refId });
  await store.writeOwnDoc(refId, body);
  return refId;
}

test('docs attach --no-embed：URL 进附件区，正文不变', async () => {
  const refId = await seedDoc('ref_aaaaaaaaaaaaaaaa', '# A\n\n原文');
  const before = await store.readOwnDoc(refId);
  const r = await action('docs.attach').run({ ref: docId(refId), url: 'https://example.com/x', noEmbed: true });
  assert.equal(r.area, 'area');
  assert.equal(r.role, 'attach');
  assert.equal(r.ref, refId, '返回的宿主是 refId');
  assert.equal(await store.readOwnDoc(refId), before, '正文必须逐字节不变');
  const listed = await action('docs.attachments').run({ ref: docId(refId) });
  assert.equal(listed.refId, refId);
  assert.equal(listed.attachments.length, 1);
  assert.equal(listed.attachments[0].kind, 'url');
  assert.equal(listed.attachments[0].role, 'attach');
});

test('docs attach --no-embed：本机图片落附件区，可查本地路径', async () => {
  const refId = 'ref_aaaaaaaaaaaaaaaa';
  const src = join(sb, '图.png');
  writeFileSync(src, 'png');
  const r = await action('docs.attach').run({ ref: docId(refId), path: src, noEmbed: true, note: '截图' });
  const listed = await action('docs.attachments').run({ ref: docId(refId) });
  const a = listed.attachments.find((x) => x.id === r.attachmentId);
  assert.ok(a, '附件区条目必须能查到');
  assert.equal(a.kind, 'file');
  assert.equal(a.role, 'attach');
  assert.ok(existsSync(a.localPath), '应带真实本地路径');
});

test('#189 docs detach 只解除关联：资源行与字节都留在孤儿池', async () => {
  const refId = 'ref_aaaaaaaaaaaaaaaa';
  const src = join(sb, '回收.pdf');
  writeFileSync(src, '%PDF');
  const r = await action('docs.attach').run({ ref: docId(refId), path: src, noEmbed: true });
  const listed = await action('docs.attachments').run({ ref: docId(refId) });
  const bytes = listed.attachments.find((x) => x.id === r.attachmentId).localPath;

  const d1 = await action('docs.detach').run({ ref: docId(refId), attachment: r.attachmentId });
  assert.equal(d1.unlinked, 1);
  assert.ok(getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.attachmentId }), '资源行保留');
  assert.ok(existsSync(bytes), '字节保留——移除不等于删资源');

  // 重新挂载可复用同一资源行（孤儿池可用）
  await action('docs.attach').run({ ref: docId(refId), fileId: r.attachmentId, noEmbed: true });
  const again = await action('docs.attachments').run({ ref: docId(refId) });
  assert.equal(again.attachments.filter((x) => x.id === r.attachmentId).length, 1);
});

test('docs attach（默认嵌入）：追加正文并落 inline 关系', async () => {
  const refId = await seedDoc('ref_bbbbbbbbbbbbbbbb', '# B');
  const r = await action('docs.attach').run({ ref: docId(refId), url: 'https://example.com/y' });
  assert.equal(r.area, 'inline');
  const body = await store.readOwnDoc(refId);
  assert.ok(body.endsWith('[https://example.com/y](https://example.com/y)'), `正文应追加链接（实际 ${body}`);
  const listed = await action('docs.attachments').run({ ref: docId(refId) });
  assert.equal(listed.attachments[0].kind, 'url');
  assert.notEqual(listed.attachments[0].role, 'attach');
});

test('清理', () => {
  try {
    closeDb();
  } catch {
    /* 已关闭 */
  }
  try {
    rmSync(sb, { recursive: true, force: true });
  } catch {
    /* Windows 偶发占用 */
  }
});
