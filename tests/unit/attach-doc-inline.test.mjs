// #162 任务级文档绑定资源化：--inline（进原文）、绑定 desc（note）、交付内联全文。
//
//   - attachToTask --ref --inline → role='doc' 边（文档资料）；--note 落边（embed 路径不再丢）；
//   - 正文同步整组重写 inline 边时不冲掉边上说明；
//   - annotateTaskDelivery({inlineDocs:true}) 读文档全文（自有树 / 绑定闭包内），截断 2 万字；
//   - 默认附件模板渲染清单 note + 〔文档原文〕段；读不到全文 fail-open（usage 退回取用命令）。
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// env 先行（模块导入前钉住独立 store/config/附件根/文档树）——绝不碰真实 ~/.nx-kv
const sb = mkdtempSync(join(tmpdir(), 'nx-kv-docinline-'));
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_CONFIG = join(sb, 'config.json'); // 不落盘 → 默认设置（自动下载关）
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_DB = join(sb, 'nxkv.db');

const service = await import('../../src/modules/localtask/service.js');
const { annotateTaskDelivery, attachmentInstruction, attachInstructionOf, attachToTask, listTaskAttachments } =
  await import('../../src/modules/tasktool/attach.js');
const { ensureDocRef, registerMdfile } = await import('../../src/core/attachmentdb.js');
const { getDb, closeDb } = await import('../../src/core/db/index.js');
const store = await import('../../src/modules/docs/store.js');

const GUIDE = '# 使用指南\n\n这是指南的正文，供内联测试使用。';

async function addTask(text) {
  const r = await service.addTask({ text });
  return r.task;
}

test('--ref --inline：落 role=doc 边，--note 随边落库（desc）', async () => {
  await store.writeOwnDoc('notes/guide.md', GUIDE);
  const t = await addTask('# 文档绑定');
  const r = await attachToTask({ id: t.id, ref: 'notes/guide.md', inline: true, note: '项目结构说明' });
  assert.equal(r.role, 'doc', '内联绑定应落 doc 边（文档资料）');
  const listed = await listTaskAttachments({ id: t.id });
  assert.equal(listed.count, 1);
  assert.equal(listed.attachments[0].role, 'doc');
  assert.equal(listed.attachments[0].note, '项目结构说明');
});

test('--ref embed 路径的 --note 不再丢（此前只落正文、说明丢失）', async () => {
  const t = await addTask('# 普通文档引用');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', note: '一行简介' });
  const listed = await listTaskAttachments({ id: t.id });
  assert.equal(listed.attachments[0].role, 'inline');
  assert.equal(listed.attachments[0].note, '一行简介');
});

test('正文同步整组重写 inline 边时不冲掉边上说明', async () => {
  const t = await addTask('# 改正文');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', note: '同步后仍在' });
  const cur = await service.getTask({ id: t.id }); // 取最新正文（含嵌入链接）再改
  await service.updateTask({ id: t.id, text: `${cur.text}\n\n追加一段正文` });
  const listed = await listTaskAttachments({ id: t.id });
  assert.equal(listed.count, 1, '嵌入链接仍在正文里，边不能丢');
  assert.equal(listed.attachments[0].note, '同步后仍在', 'desc 不是正文的一部分，重写必须保留');
});

test('--inline 只支持 --ref：其他来源报参数错', async () => {
  const t = await addTask('# 校验');
  await assert.rejects(() => attachToTask({ id: t.id, fileId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', inline: true }), /--inline/u);
  await assert.rejects(() => attachToTask({ id: t.id, url: 'https://example.com/x', inline: true }), /--inline/u);
});

test('inline + no-embed 叠加：仍落 doc 边，正文不动', async () => {
  const t = await addTask('# 区域内文档');
  const before = t.text;
  const r = await attachToTask({ id: t.id, ref: 'notes/guide.md', inline: true, noEmbed: true });
  assert.equal(r.role, 'doc');
  assert.equal(r.area, 'area');
  const shown = await service.getTask({ id: t.id });
  assert.equal(shown.text, before, 'no-embed 不改正文');
});

test('先 attach（附件区）再 --inline：换成 doc 边（最新显式意图获胜）', async () => {
  const t = await addTask('# 换边');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', noEmbed: true, note: '旧说明' });
  assert.equal((await listTaskAttachments({ id: t.id })).attachments[0].role, 'attach');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', inline: true, note: '新说明' });
  const a = (await listTaskAttachments({ id: t.id })).attachments[0];
  assert.equal(a.role, 'doc');
  assert.equal(a.note, '新说明');
});

test('交付内联：inlineDocs=true 读自有树全文，指令段出现〔文档原文〕', async () => {
  const t = await addTask('# 内联交付');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', inline: true });
  const att = await annotateTaskDelivery(await service.getTask({ id: t.id }), { inlineDocs: true });
  const a = att.task.attachments[0];
  assert.equal(a.role, 'doc');
  assert.ok(a.docContent && a.docContent.includes('供内联测试使用'), '应读到自有树全文');
  assert.equal(a.docTruncated, false);
  const seg = attachmentInstruction(att.task.attachments, null);
  assert.match(seg, /〔文档原文 · 使用指南〕/);
  assert.match(seg, /供内联测试使用/);
  assert.match(seg, /文档资料绑定（进原文）/, 'usage 指向原文段');
});

test('不传 inlineDocs：载荷不带内容、指令段无〔文档原文〕（旧行为不变）', async () => {
  const t = await addTask('# 不内联');
  await attachToTask({ id: t.id, ref: 'notes/guide.md', inline: true });
  const att = await annotateTaskDelivery(await service.getTask({ id: t.id }));
  const a = att.task.attachments[0];
  assert.equal(a.docContent, undefined, '未开内联 → 不读全文');
  assert.doesNotMatch(attachmentInstruction(att.task.attachments, null), /文档原文/);
});

test('fail-open：文档缺失 → 内容留空，usage 退回 docs get 命令', async () => {
  await store.writeOwnDoc('notes/gone.md', '# 会消失');
  const t = await addTask('# 缺文档');
  await attachToTask({ id: t.id, ref: 'notes/gone.md', inline: true });
  // v6：正文在 ref_bodies，删镜像已无意义；条目也删掉才是「文档缺失」
  getDb().run('DELETE FROM refs WHERE rel = :rel', { rel: 'notes/gone.md' });
  const att = await annotateTaskDelivery(await service.getTask({ id: t.id }), { inlineDocs: true });
  const a = att.task.attachments[0];
  assert.equal(a.docContent, undefined);
  const seg = attachmentInstruction(att.task.attachments, null);
  assert.match(seg, /无法内联|正文缺失/);
  assert.doesNotMatch(seg, /文档原文 · /);
});

test('超 2 万字截断：docTruncated 标记 + usage 给完整版读取命令', async () => {
  const long = '# 长文档\n\n' + '字'.repeat(21000);
  await store.writeOwnDoc('notes/long.md', long);
  const t = await addTask('# 长文');
  await attachToTask({ id: t.id, ref: 'notes/long.md', inline: true });
  const att = await annotateTaskDelivery(await service.getTask({ id: t.id }), { inlineDocs: true });
  const a = att.task.attachments[0];
  assert.equal(a.docTruncated, true);
  assert.equal(a.docContent.length, 20000);
  const seg = attachmentInstruction(att.task.attachments, null);
  assert.match(seg, /内容有截断/);
  assert.match(seg, /docs get --ref ref_/);
});

test('外部文档：登记为 mdfile → 读全文；未登记 → fail-open + 显式登记命令', async () => {
  const extDir = mkdirSync(join(sb, 'ext'), { recursive: true });
  const extFile = join(extDir, 'outer.md');
  writeFileSync(extFile, '# 外部文档\n\n登记后的正文。');
  ensureDocRef(getDb(), { locator: extFile.replace(/\\/g, '/') });
  registerMdfile(getDb(), { path: extFile });

  const t = await addTask('# 外部内联');
  await attachToTask({ id: t.id, ref: extFile, inline: true });
  const att = await annotateTaskDelivery(await service.getTask({ id: t.id }), { inlineDocs: true });
  assert.match(att.task.attachments[0].docContent, /登记后的正文/);

  // 未登记为 mdfile：不直读盘 → 显式说明「无法内联」并给可直接执行的登记命令
  const outside = join(sb, 'outside.md');
  writeFileSync(outside, '# 不给读');
  ensureDocRef(getDb(), { locator: outside.replace(/\\/g, '/') });
  const t2 = await addTask('# 未登记');
  await attachToTask({ id: t2.id, ref: outside, inline: true });
  const att2 = await annotateTaskDelivery(await service.getTask({ id: t2.id }), { inlineDocs: true });
  const a2 = att2.task.attachments[0];
  assert.equal(a2.docContent, undefined);
  assert.equal(a2.docMissing, true);
  const seg = attachmentInstruction(att2.task.attachments, null);
  assert.match(seg, /未登记为附件，无法内联/);
  assert.match(seg, /localtask attach .*--mdfile/u);
});

test('清单 note 渲染：默认模板透出 desc；模板坏了纯文本兜底仍带原文段', () => {
  const rows = [
    { id: 'r1', kind: 'ref', name: '指南', role: 'doc', refId: 'ref_guide', note: '项目结构说明', docContent: '指南正文' },
  ];
  const seg = attachmentInstruction(rows, null);
  assert.match(seg, /# 项目结构说明/, '清单行带 desc');
  assert.match(seg, /〔文档原文 · 指南〕/);
  const out = attachInstructionOf('清单：{{attach.list}}', rows, { id: 1 });
  assert.match(out, /〔文档原文 · 指南〕/, '回落渲染仍带原文段');
});

test('清理', () => {
  try { closeDb(); } catch {}
  try { rmSync(sb, { recursive: true, force: true }); } catch {}
});
