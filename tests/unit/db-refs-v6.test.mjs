// v6：refs 正文入库（rel 归位 / ref_bodies / 外部 mdfile / 壳行语义）。
//
// 覆盖 2026-11-12 二轮确认的五点口径：
//   ① 盘上无文件的 102 行保持空壳（不软删、body_bytes=0）；
//   ② 外部绝对路径文件仍在 → mdfile + ref_attach(role='source')；不在 → 只留空壳；
//   ③ 存量 id 保留（方案 A：ref_<sha1(rel)> 只用于新行）；
//   ④ 盘上正文逐篇 sha256 落库（回读比对硬门禁由迁移内部执行）；
//   ⑤ 读路径区分 normal / legacy / external / empty，docs get 返回 missing + 原因。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { buildV1Sample, SAMPLE } from '../fixtures/db-samples.mjs';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/db/version.js';
import { resolveRefId } from '../../src/core/attachmentdb.js';
import * as store from '../../src/modules/docs/store.js';
import { getDoc, listDocs } from '../../src/modules/docs/service.js';

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

test('v6 迁移：rel 归位 / 正文入库 / 外部 mdfile / 壳行语义 / 级联', async () => {
  const s = await createTestStore({ open: false, importLegacy: false });
  const oldAtt = process.env.NX_KV_ATTACHMENTS;
  const oldDocs = process.env.NX_KV_DOCS_DIR;
  process.env.NX_KV_ATTACHMENTS = join(s.appDir, 'attachments');
  process.env.NX_KV_DOCS_DIR = join(s.appDir, 'docs');
  try {
    buildV1Sample(s);

    // 外部绝对路径：一份仍在、一份已不在
    const extDir = join(s.dir, 'ext');
    mkdirSync(extDir, { recursive: true });
    const extOk = join(extDir, 'external-ok.md');
    const extGone = join(extDir, 'gone.md');
    writeFileSync(extOk, '# 外部文档\n\n外部正文\n', 'utf8');

    // v6 之前的 4 类历史行：相对缺文件 / 空 locator / 外部仍在 / 外部已丢
    const at = Date.now();
    const raw = s.core.openRaw(s.dbPath);
    const add = (id, locator) =>
      raw.run(
        `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
         VALUES (:id, 'md', :locator, '', 0, NULL, :at, :at)`,
        { id, locator, at }
      );
    add('ref_ghost', 'repo/acme/ghost.md');
    add('ref_empty', '');
    add('ref_ext_ok', extOk);
    add('ref_ext_gone', extGone);
    s.core.closeDb();

    s.db = s.core.openStore({ path: s.dbPath, appDir: s.appDir, importLegacyData: false });
    assert.equal(s.db.get('PRAGMA user_version').user_version, CURRENT_SCHEMA_VERSION);

    // ① 存量 id 保留 + rel 归位 + 正文入库
    const sample = s.db.get('SELECT id, rel, origin, body_bytes FROM refs WHERE locator = :loc', {
      loc: SAMPLE.docRel,
    });
    assert.equal(sample.id, 'ref_' + sha1(SAMPLE.docRel).slice(0, 16), '存量 id 不许被新公式改写');
    assert.equal(sample.rel, SAMPLE.docRel);
    assert.equal(sample.origin, 'import');
    const sampleBody = '# sample\n\n[链接](https://example.com/spec)\n';
    const body = s.db.get('SELECT body, body_bytes, body_hash FROM ref_bodies WHERE ref_id = :id', {
      id: sample.id,
    });
    assert.equal(body.body, sampleBody);
    assert.equal(body.body_bytes, Buffer.byteLength(sampleBody, 'utf8'));
    assert.equal(body.body_hash, sha256(sampleBody));

    // ② 盘上无文件的行保持空壳（不软删、不删行）
    const ghost = s.db.get('SELECT rel, origin, body_bytes, deleted_at FROM refs WHERE id = :id', {
      id: 'ref_ghost',
    });
    assert.equal(ghost.rel, 'repo/acme/ghost.md');
    assert.equal(ghost.body_bytes, 0);
    assert.equal(ghost.deleted_at, null);
    assert.equal(
      s.db.get('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: 'ref_ghost' }).c,
      0
    );

    // ③ 空 locator → legacy/<id>
    const empty = s.db.get('SELECT rel FROM refs WHERE id = :id', { id: 'ref_empty' });
    assert.equal(empty.rel, 'legacy/ref_empty');

    // ④ 外部文件仍在 → mdfile + source 边；不在 → 只留空壳
    const okRel = s.db.get('SELECT rel, origin FROM refs WHERE id = :id', { id: 'ref_ext_ok' });
    assert.match(okRel.rel, /^external\//);
    assert.equal(okRel.origin, 'external');
    const att = s.db.get("SELECT id, kind, abs_path, storage FROM attachments WHERE kind = 'mdfile'");
    assert.ok(att, '外部文件仍在必须登记 mdfile');
    assert.equal(att.kind, 'mdfile');
    assert.equal(att.storage, 'external');
    // Windows 盘符大小写不敏感：按小写比对
    assert.equal(att.abs_path.toLowerCase(), resolve(extOk).toLowerCase());
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM ref_attach WHERE ref_id = 'ref_ext_ok' AND role = 'source'").c,
      1
    );
    const gone = s.db.get('SELECT rel, origin FROM refs WHERE id = :id', { id: 'ref_ext_gone' });
    assert.match(gone.rel, /^external\//);
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM ref_attach WHERE ref_id = 'ref_ext_gone'").c,
      0,
      '文件不在 → 不登记 source 边'
    );
    assert.equal(s.db.get("SELECT count(*) AS c FROM attachments WHERE kind = 'mdfile'").c, 1);

    // ⑤ 迁移证据落 meta
    const meta = JSON.parse(s.db.get("SELECT value FROM meta WHERE key = 'refs_v6'").value);
    assert.equal(meta.files, 1);
    assert.equal(meta.bodies, 1);
    assert.equal(meta.relEmpty, 0);
    assert.equal(meta.emptyBody, 4, 'ghost / empty / ext_ok / ext_gone 都没有正文');

    // ⑥ 身份解析：rel 优先、id 直查都成立
    assert.equal(resolveRefId(s.db, 'rel:' + SAMPLE.docRel), sample.id);
    assert.equal(resolveRefId(s.db, SAMPLE.docRel), sample.id);
    assert.equal(resolveRefId(s.db, 'legacy/ref_empty'), 'ref_empty');

    // ⑦ 读路径：正常文档走 DB；壳行显式「无正文」
    const saved = await store.writeOwnDoc('notes/new.md', '# 新文档\n\n正文\n');
    assert.equal(saved, 'notes/new.md');
    assert.equal(await store.readOwnDoc('notes/new.md'), '# 新文档\n\n正文\n');
    assert.ok(!existsSync(join(s.appDir, 'docs', 'notes', 'new.md')), '不再落盘：正文只存 DB');
    const normal = await store.ownDocState('notes/new.md');
    assert.equal(normal.relKind, 'normal');
    assert.equal(normal.hasBody, true);

    const shell = await store.ownDocState('legacy/ref_empty');
    assert.equal(shell.exists, true);
    assert.equal(shell.hasBody, false);
    assert.equal(shell.relKind, 'legacy');
    assert.ok(shell.reason.includes('历史'));

    await assert.rejects(() => store.readOwnDoc('legacy/ref_empty'), /文档不存在/);

    const got = await getDoc({ ref: 'rel:legacy/ref_empty' });
    assert.equal(got.missing, true);
    assert.equal(got.relKind, 'legacy');
    assert.ok(String(got.reason || '').length > 0, 'docs get 必须说明为什么没有正文');

    const listed = await listDocs({});
    const shellItem = listed.docs.find((x) => x.rel === 'legacy/ref_empty');
    assert.ok(shellItem, 'docs list 必须包含壳行（显式标注）');
    assert.equal(shellItem.hasBody, false);
    assert.equal(shellItem.missing, true);
    const extItem = listed.docs.find((x) => x.rel === okRel.rel);
    assert.equal(extItem.relKind, 'external');
    assert.equal(extItem.hasBody, false);

    // ⑧ 级联：删 refs 行 → 正文与关系一起消失
    s.db.run('DELETE FROM refs WHERE id = :id', { id: sample.id });
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: sample.id }).c, 0);
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_attach WHERE ref_id = :id', { id: sample.id }).c, 0);
  } finally {
    s.reset();
    if (oldAtt === undefined) delete process.env.NX_KV_ATTACHMENTS;
    else process.env.NX_KV_ATTACHMENTS = oldAtt;
    if (oldDocs === undefined) delete process.env.NX_KV_DOCS_DIR;
    else process.env.NX_KV_DOCS_DIR = oldDocs;
  }
});
