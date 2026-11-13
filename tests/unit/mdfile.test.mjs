// mdfile（kind='mdfile' 的本地 md 指针）：身份、登记、读时校验、CLI 动作与交付注入。
//
// 语义来自 docs/decisions/2026-11-12-refs-body-in-db.md：
//   · O7 文件失效只标 missing_at，不软删、不删行；读时校验 hash，漂移只报 stale；
//   · O8 相对锚点 = 登记时文件所在目录（anchor_dir）；
//   · O9 docsRoot() 内的文件禁止登记为 mdfile，直接报错并指路 ref；
//   · 交付上下文注入正文（截断 2 万字），读失败 fail-open。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

// env 先行（模块导入前钉住独立库 / 文档树 / 附件根）——绝不碰真实 ~/.nx-kv
const sb = mkdtempSync(join(tmpdir(), 'nx-kv-mdfile-'));
const docsRoot = join(sb, 'docs');
const extDir = join(sb, 'ext');
mkdirSync(extDir, { recursive: true });
process.env.NX_KV_DB = join(sb, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_CONFIG = join(sb, 'config.json');
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_DOCS_DIR = docsRoot;
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');

const svc = await import('../../src/modules/localtask/service.js');
const { annotateTaskDelivery, attachToTask, attachmentInstruction, listTaskAttachments } = await import(
  '../../src/modules/tasktool/attach.js'
);
const {
  ensureDocRef,
  ensureMdfileAttachment,
  listMdfiles,
  mdfileAttachmentId,
  normalizeMdfilePath,
  parseAttachmentRefs,
  readMdfile,
  registerMdfile,
} = await import('../../src/core/attachmentdb.js');
const { getDb, closeDb } = await import('../../src/core/db/index.js');
const store = await import('../../src/modules/docs/store.js');
const docsMod = (await import('../../src/modules/docs/index.js')).default;

// v8：宿主文档只按 refId 寻址（没有 rel / 路径）；正文进 ref_bodies。
let hostSeq = 0;
async function makeHostDoc(md) {
  hostSeq += 1;
  const id = 'ref_' + String(hostSeq).padStart(16, '0');
  ensureDocRef(getDb(), { ref: id });
  await store.writeOwnDoc(id, md);
  return id;
}
const hostId = await makeHostDoc('# A\n\n原文');

const action = (id) => {
  const a = docsMod.actions.find((x) => x.id === id);
  assert.ok(a, `缺 action ${id}`);
  return a;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function makeMd(name, text) {
  const p = join(extDir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, 'utf8');
  return p;
}

test('身份：路径规范化幂等；盘符大小写不敏感、其余大小写保留', () => {
  const a = mdfileAttachmentId('a/b.md');
  assert.match(a, /^att_mdfile_[0-9a-f]{16}$/);
  assert.equal(mdfileAttachmentId('./a/../a/b.md'), a, '同一路径的不同写法必须是同一 id');
  assert.ok(isAbsolute(normalizeMdfilePath('a/b.md')), '规范化结果必须是绝对路径');
  if (process.platform === 'win32') {
    assert.equal(mdfileAttachmentId('C:\\x\\A.md'), mdfileAttachmentId('c:\\x\\A.md'), '盘符大小写不敏感');
    assert.notEqual(mdfileAttachmentId('C:\\x\\A.md'), mdfileAttachmentId('C:\\x\\a.md'), '其余部分按原样参与身份');
  }
});

test('正文解析：nxkv://mdfile/<id> 落 mdfile 引用（role=inline）', () => {
  const refs = parseAttachmentRefs('见 [计划](nxkv://mdfile/att_mdfile_abc123)');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, 'mdfile');
  assert.equal(refs[0].targetMdfileId, 'att_mdfile_abc123');
  assert.equal(refs[0].role, 'inline');
});

test('未登记的 mdfile 引用不会凭 id 造行（ensure 返回 null）', () => {
  assert.equal(ensureMdfileAttachment(getDb(), { id: 'att_mdfile_0000000000000000' }), null);
});

test('registerMdfile：只收 .md、文件必须存在；默认目录内同样放行（只经 attach 访问）', () => {
  const db = getDb();
  assert.throws(() => registerMdfile(db, { path: join(extDir, 'a.txt') }), /只接受 \.md/);
  const inside = join(docsRoot, 'notes', 'mine.md');
  mkdirSync(dirname(inside), { recursive: true });
  writeFileSync(inside, '# mdfile 默认目录内');
  const r = registerMdfile(db, { path: inside });
  assert.equal(r.id, mdfileAttachmentId(inside), '默认目录内的文件可以登记为 mdfile');
  assert.throws(() => registerMdfile(db, { path: join(extDir, 'nope.md') }), /文件不存在/);
});

test('registerMdfile：落 external + 路径/锚点/指纹；重复登记幂等刷新', () => {
  const db = getDb();
  const p = makeMd('plan.md', '# 计划\n\n第一版');
  const r = registerMdfile(db, { path: p });
  assert.equal(r.id, mdfileAttachmentId(p));
  assert.equal(r.name, 'plan.md');
  assert.equal(r.absPath, normalizeMdfilePath(p));
  assert.equal(r.anchorDir, dirname(normalizeMdfilePath(p)));
  assert.equal(r.hash, sha256('# 计划\n\n第一版'));
  assert.equal(r.size, Buffer.byteLength('# 计划\n\n第一版'));

  const row = db.get('SELECT * FROM attachments WHERE id = :id', { id: r.id });
  assert.equal(row.kind, 'mdfile');
  assert.equal(row.storage, 'external');
  assert.equal(row.mime, 'text/markdown; charset=utf-8');
  assert.equal(row.local_path, '');
  assert.equal(row.deleted_at, null);
  assert.equal(row.missing_at, null);

  writeFileSync(p, '# 计划\n\n第二版', 'utf8');
  const r2 = registerMdfile(db, { path: p });
  assert.equal(r2.id, r.id, '同一路径重登记必须同 id');
  assert.equal(r2.hash, sha256('# 计划\n\n第二版'));
  assert.equal(db.get("SELECT count(*) AS c FROM attachments WHERE kind = 'mdfile' AND abs_path = :p COLLATE NOCASE", { p: normalizeMdfilePath(p) }).c, 1);
});

test('readMdfile：正常读到正文；内容漂移只报 stale 不改库；缺失标 missing_at 不删行', () => {
  const db = getDb();
  const p = makeMd('read.md', '# 读我');
  const r = registerMdfile(db, { path: p, docsRoot });

  const ok = readMdfile(db, r.id);
  assert.equal(ok.body, '# 读我');
  assert.equal(ok.stale, false);
  assert.equal(ok.missing, false);
  assert.ok(db.get('SELECT last_seen_at FROM attachments WHERE id = :id', { id: r.id }).last_seen_at);

  writeFileSync(p, '# 改过了', 'utf8');
  const stale = readMdfile(db, r.id);
  assert.equal(stale.body, '# 改过了');
  assert.equal(stale.stale, true);
  assert.equal(stale.missing, false);
  assert.equal(
    db.get('SELECT hash FROM attachments WHERE id = :id', { id: r.id }).hash,
    r.hash,
    'stale 不自动改库（指纹仍是被登记时的值）'
  );

  unlinkSync(p);
  const gone = readMdfile(db, r.id);
  assert.equal(gone.missing, true);
  assert.equal(gone.body, '');
  assert.ok(gone.missingAt);
  const row = db.get('SELECT missing_at, deleted_at FROM attachments WHERE id = :id', { id: r.id });
  assert.equal(row.deleted_at, null, 'O7：失效不软删、不删行');
  assert.equal(row.missing_at, gone.missingAt);

  assert.deepEqual(listMdfiles(db, { missingOnly: true }).map((x) => x.id), [r.id]);
  assert.equal(listMdfiles(db)[0].missing, true);

  writeFileSync(p, '# 回来了', 'utf8');
  const back = readMdfile(db, r.id);
  assert.equal(back.missing, false);
  assert.equal(db.get('SELECT missing_at FROM attachments WHERE id = :id', { id: r.id }).missing_at, null, '恢复后清 missing_at');
});

test('docs link-file：只登记并挂附件区，正文逐字节不变', async () => {
  const before = await store.readOwnDoc(hostId);
  const p = makeMd('linked.md', '# 外部方案');
  const r = await action('doc.link-file').run({ ref: hostId, path: p, note: '方案原文' });
  assert.equal(r.attachmentId, mdfileAttachmentId(p));
  assert.equal(await store.readOwnDoc(hostId), before, '正文必须逐字节不变');

  const listed = await action('doc.attachments').run({ ref: hostId });
  const a = listed.attachments.find((x) => x.id === r.attachmentId);
  assert.ok(a, '附件区必须能查到');
  assert.equal(a.kind, 'mdfile');
  assert.equal(a.role, 'attach');
  assert.equal(a.absPath, normalizeMdfilePath(p));
});

test('docs link-file 允许指向 mdfile 默认目录内的 md（只能经 attach 访问）', async () => {
  const inside = join(docsRoot, 'notes', 'inside.md');
  mkdirSync(dirname(inside), { recursive: true });
  writeFileSync(inside, '# 默认目录内的 md');
  const r = await action('doc.link-file').run({ ref: hostId, path: inside });
  assert.match(r.attachmentId, /^att_mdfile_[0-9a-f]{16}$/);
});

test('docs mdfile / mdfiles：读正文、列台账、失效过滤', async () => {
  const p = makeMd('list.md', '# 台账');
  const r = await action('doc.link-file').run({ ref: hostId, path: p });

  const read = await action('doc.mdfile').run({ attachment: r.attachmentId });
  assert.equal(read.body, '# 台账');
  assert.equal(read.missing, false);

  const all = await action('doc.mdfiles').run({});
  assert.ok(all.some((x) => x.id === r.attachmentId));

  unlinkSync(p);
  const gone = await action('doc.mdfile').run({ attachment: r.attachmentId });
  assert.equal(gone.missing, true);
  const miss = await action('doc.mdfiles').run({ missing: true });
  assert.deepEqual(miss.map((x) => x.id), [r.attachmentId]);
  assert.equal(existsSync(p), false);
});

test('localtask attach --mdfile：正文落 nxkv://mdfile 链接；--no-embed 只进附件区', async () => {
  const p = makeMd('task.md', '# 任务 md\n\n正文');
  const t = (await svc.addTask({ text: '# 挂 md' })).task;
  const r = await attachToTask({ id: t.id, mdfile: p, note: '外部计划' });
  assert.equal(r.kind, 'mdfile');
  assert.equal(r.role, 'inline');
  assert.match(r.markdown, /^\[task\.md\]\(nxkv:\/\/mdfile\/att_mdfile_[0-9a-f]{16}\)$/);
  assert.ok(r.task.text.endsWith(r.markdown), '默认嵌入正文末尾');

  const listed = await listTaskAttachments({ id: t.id });
  assert.equal(listed.count, 1);
  assert.equal(listed.attachments[0].kind, 'mdfile');
  assert.equal(listed.attachments[0].absPath, normalizeMdfilePath(p));

  const t2 = (await svc.addTask({ text: '# 只进附件区' })).task;
  const before = t2.text;
  const r2 = await attachToTask({ id: t2.id, mdfile: p, noEmbed: true });
  assert.equal(r2.area, 'area');
  assert.equal((await svc.getTask({ id: t2.id })).text, before);
});

test('交付注入：正文进附件清单与默认模板（stale / missing / 截断）', async () => {
  const p = makeMd('deliver.md', '# 交付\n\n外部正文');
  const t = (await svc.addTask({ text: '# 交付任务' })).task;
  await attachToTask({ id: t.id, mdfile: p });

  let att = await annotateTaskDelivery(await svc.getTask({ id: t.id }));
  let a = att.task.attachments.find((x) => x.kind === 'mdfile');
  assert.equal(a.mdContent, '# 交付\n\n外部正文');
  assert.equal(a.mdMissing, false);
  assert.equal(a.mdStale, false);
  let seg = attachmentInstruction(att.task.attachments, null);
  assert.match(seg, /〔外部 md · deliver\.md〕/);
  assert.ok(seg.includes('外部正文'), '模板必须注入正文');
  assert.match(seg, /docs mdfile att_mdfile_/);

  writeFileSync(p, '# 交付\n\n改过的正文', 'utf8');
  att = await annotateTaskDelivery(await svc.getTask({ id: t.id }));
  a = att.task.attachments.find((x) => x.kind === 'mdfile');
  assert.equal(a.mdStale, true);
  assert.ok(a.mdContent.includes('改过的正文'));
  assert.match(attachmentInstruction(att.task.attachments, null), /内容有变化/);

  unlinkSync(p);
  att = await annotateTaskDelivery(await svc.getTask({ id: t.id }));
  a = att.task.attachments.find((x) => x.kind === 'mdfile');
  assert.equal(a.mdMissing, true);
  assert.equal(a.mdContent, '');
  seg = attachmentInstruction(att.task.attachments, null);
  assert.doesNotMatch(seg, /〔外部 md · /);
  assert.match(seg, /源文件已不在|不可读/, 'missing 时清单行要明说');

  const long = makeMd('long.md', '# 长文\n\n' + '字'.repeat(21000));
  const t2 = (await svc.addTask({ text: '# 长文任务' })).task;
  await attachToTask({ id: t2.id, mdfile: long });
  const att2 = await annotateTaskDelivery(await svc.getTask({ id: t2.id }));
  const a2 = att2.task.attachments.find((x) => x.kind === 'mdfile');
  assert.equal(a2.mdTruncated, true);
  assert.equal(a2.mdContent.length, 20000);
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
