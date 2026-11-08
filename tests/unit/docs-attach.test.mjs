// 文档侧附件区：docs attach --no-embed 只写 ref_attach，不碰正文；
// docs attachments 能列出附件区条目；detach 区分只解除与连字节删除。
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-docatt-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');

const store = await import('../../src/modules/docs/store.js');
const docsMod = (await import('../../src/modules/docs/index.js')).default;
const { getDb, closeDb } = await import('../../src/core/db/index.js');

const action = (id) => docsMod.actions.find((a) => a.id === id);

test('docs attach --no-embed：URL 进附件区，正文不变', async () => {
  await store.writeOwnDoc('notes/a.md', '# A\n\n原文');
  const before = await store.readOwnDoc('notes/a.md');
  const r = await action('doc.attach').run({ ref: 'notes/a.md', url: 'https://example.com/x', noEmbed: true });
  assert.equal(r.area, 'area');
  assert.equal(r.role, 'attach');
  assert.equal(await store.readOwnDoc('notes/a.md'), before, '正文必须逐字节不变');
  const listed = await action('doc.attachments').run({ ref: 'notes/a.md' });
  assert.equal(listed.attachments.length, 1);
  assert.equal(listed.attachments[0].kind, 'url');
  assert.equal(listed.attachments[0].role, 'attach');
});

test('docs attach --no-embed：本机图片落附件区，可查本地路径', async () => {
  const src = join(sb, '图.png');
  writeFileSync(src, 'png');
  const r = await action('doc.attach').run({ ref: 'notes/a.md', path: src, noEmbed: true, note: '截图' });
  const listed = await action('doc.attachments').run({ ref: 'notes/a.md' });
  const a = listed.attachments.find((x) => x.id === r.attachmentId);
  assert.ok(a, '附件区条目必须能查到');
  assert.equal(a.kind, 'file');
  assert.equal(a.role, 'attach');
  assert.ok(existsSync(a.localPath), '应带真实本地路径');
});

test('docs detach：只解除关系；--purge 无人引用时删行与字节', async () => {
  const src = join(sb, '回收.pdf');
  writeFileSync(src, '%PDF');
  const r = await action('doc.attach').run({ ref: 'notes/a.md', path: src, noEmbed: true });
  const listed = await action('doc.attachments').run({ ref: 'notes/a.md' });
  const bytes = listed.attachments.find((x) => x.id === r.attachmentId).localPath;

  const d1 = await action('doc.detach').run({ ref: 'notes/a.md', attachment: r.attachmentId });
  assert.equal(d1.unlinked, 1);
  assert.equal(d1.purged, false);
  assert.ok(getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.attachmentId }));
  assert.ok(existsSync(bytes), '默认不删字节');

  await action('doc.attach').run({ ref: 'notes/a.md', fileId: r.attachmentId, noEmbed: true });
  const d2 = await action('doc.detach').run({ ref: 'notes/a.md', attachment: r.attachmentId, purge: true });
  assert.equal(d2.purged, true);
  assert.ok(!getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.attachmentId }));
  assert.ok(!existsSync(bytes), 'purge 删除本机字节');
});

test('docs attach（默认嵌入）：追加正文并落 inline 关系', async () => {
  await store.writeOwnDoc('notes/b.md', '# B');
  const r = await action('doc.attach').run({ ref: 'notes/b.md', url: 'https://example.com/y' });
  assert.equal(r.area, 'inline');
  const body = await store.readOwnDoc('notes/b.md');
  assert.ok(body.endsWith('[https://example.com/y](https://example.com/y)'), `正文应追加链接（实际 ${body}`);
  const listed = await action('doc.attachments').run({ ref: 'notes/b.md' });
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
