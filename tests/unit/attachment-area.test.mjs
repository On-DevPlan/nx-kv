// 附件区（不依赖正文）的读写语义：
//   attach --no-embed 只写关系；正文同步不降级显式边；删正文不丢附件区；
//   detach 默认只解除关系，--purge 才删资源与字节；领取交付区分「正文内嵌/附件区」。
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-area-'));
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_CONFIG = join(sb, 'config.json');
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');

const service = await import('../../src/modules/localtask/service.js');
const { attachToTask, detachTaskAttachment, listTaskAttachments, annotateTaskDelivery, attachmentInstruction } =
  await import('../../src/modules/tasktool/attach.js');
const { getDb } = await import('../../src/core/db/index.js');

const areaOf = (d, id) => d.attachments.find((a) => a.id === id);

test('attach --no-embed：pdf 只进附件区，正文逐字节不变', async () => {
  const src = join(sb, '规格.pdf');
  writeFileSync(src, '%PDF-1.4 sample');
  const added = await service.addTask({ text: '# 附件区任务\n正文保持原样' });
  const r = await attachToTask({ id: added.task.id, path: src, noEmbed: true, note: '规格书' });
  assert.equal(r.area, 'area');
  assert.equal(r.role, 'attach');
  assert.equal(r.markdown, '', 'no-embed 不生成嵌入片段');
  const shown = await service.getTask({ id: added.task.id });
  assert.ok(shown.text.endsWith('正文保持原样'), '正文不得被追加');
  const listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 1);
  assert.equal(listed.areaCount, 1);
  const a = areaOf(listed, r.fileId);
  assert.equal(a.area, 'area');
  assert.equal(a.role, 'attach');
  assert.equal(a.kind, 'file');
  assert.ok(existsSync(a.localPath), '附件区应能看到真实本地路径');
});

test('attach --no-embed：--url / --task 也进附件区并被交付列出', async () => {
  const added = await service.addTask({ text: '# 内部资源' });
  const url = await attachToTask({ id: added.task.id, url: 'https://example.com/spec', noEmbed: true });
  assert.equal(url.kind, 'url');
  assert.equal(url.area, 'area');
  const target = await service.addTask({ text: '# 被引用的任务' });
  const task = await attachToTask({ id: added.task.id, task: String(target.task.id), noEmbed: true });
  assert.equal(task.kind, 'task');
  assert.equal(task.area, 'area');

  const listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 2);
  assert.ok(listed.attachments.every((a) => a.area === 'area'));
  assert.equal(areaOf(listed, url.fileId).url, 'https://example.com/spec');
  assert.equal(areaOf(listed, task.fileId).targetKind, 'task');

  const att = await annotateTaskDelivery(added.task);
  assert.ok(att, '附件区条目也必须出现在领取交付里');
  assert.ok(att.task.attachments.some((a) => a.area === 'area'));
  const seg = attachmentInstruction(att.task.attachments, att.sync);
  assert.ok(seg.includes('[附件区'), 'instruction 必须区分正文内嵌与附件区');
  assert.ok(seg.includes('https://example.com/spec'));
});

test('正文同步不降级显式边：先 inline，再 --no-embed 升为 attach，删正文行仍保留', async () => {
  const src = join(sb, '图.png');
  writeFileSync(src, 'png');
  const added = await service.addTask({ text: '# 升级' });
  const r = await attachToTask({ id: added.task.id, path: src }); // 默认 inline
  let listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(areaOf(listed, r.fileId).role, 'inline');

  // 对同一资源再显式挂到附件区：关系升级为 attach
  await attachToTask({ id: added.task.id, fileId: r.fileId, noEmbed: true });
  listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(areaOf(listed, r.fileId).role, 'attach');

  // 删掉正文里的那行：inline 同步不能把 attach 边删掉
  await service.updateTask({ id: added.task.id, text: '# 升级\n正文已删' });
  listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 1);
  assert.equal(areaOf(listed, r.fileId).role, 'attach');
  assert.equal(areaOf(listed, r.fileId).area, 'area');
});

test('删正文行：inline 边跟随消失，资源进孤儿池（不删字节）', async () => {
  const src = join(sb, '临时.png');
  writeFileSync(src, 'png');
  const added = await service.addTask({ text: '# 临时' });
  const r = await attachToTask({ id: added.task.id, path: src });
  await service.updateTask({ id: added.task.id, text: '# 临时\n（正文里没有附件了）' });
  const listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 0, 'inline 边随正文消失');
  const row = getDb().get('SELECT id, deleted_at FROM attachments WHERE id = :id', { id: r.fileId });
  assert.ok(row && row.deleted_at === null, '资源行保留在孤儿池，不随正文删除');
  assert.ok(existsSync(src), '源文件当然不动');
});

test('detach 默认只解除关系；--purge 才删资源行与字节；被引用时拒绝 purge', async () => {
  const src = join(sb, '回收.pdf');
  writeFileSync(src, '%PDF');
  const a = await service.addTask({ text: '# 回收 A' });
  const b = await service.addTask({ text: '# 回收 B' });
  const r = await attachToTask({ id: a.task.id, path: src, noEmbed: true });
  await attachToTask({ id: b.task.id, fileId: r.fileId, noEmbed: true });

  // A 解除时 B 仍在用 → 只解除关系，purge 拒绝删
  const d1 = await detachTaskAttachment({ id: a.task.id, attachment: r.fileId, purge: true });
  assert.equal(d1.unlinked, 1);
  assert.equal(d1.purged, false);
  assert.equal(d1.purgeReason, 'in-use');
  assert.equal((await listTaskAttachments({ id: a.task.id })).count, 0);
  assert.ok(getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.fileId }), '被他人引用时资源必须保留');

  // 默认只解除 B 的关系：资源仍在孤儿池
  const d2 = await detachTaskAttachment({ id: b.task.id, attachment: r.fileId });
  assert.equal(d2.unlinked, 1);
  assert.equal(d2.purged, false);
  assert.ok(getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.fileId }), '默认不删资源');

  // 已无引用 → 再挂一条并 purge 可回收（行 + 本机字节）
  const c = await service.addTask({ text: '# 回收 C' });
  await attachToTask({ id: c.task.id, fileId: r.fileId, noEmbed: true });
  const bytes = (await listTaskAttachments({ id: c.task.id })).attachments[0].localPath;
  assert.ok(existsSync(bytes), 'purge 前字节在盘');
  const d3 = await detachTaskAttachment({ id: c.task.id, attachment: r.fileId, purge: true });
  assert.equal(d3.purged, true);
  assert.ok(!getDb().get('SELECT id FROM attachments WHERE id = :id', { id: r.fileId }), '资源行已删除');
  assert.ok(!existsSync(bytes), '本机字节已删除');
});

test('清理', () => {
  try {
    service.closeDb();
  } catch {
    /* 已关闭 */
  }
  try {
    rmSync(sb, { recursive: true, force: true });
  } catch {
    /* Windows 偶发占用 */
  }
});
