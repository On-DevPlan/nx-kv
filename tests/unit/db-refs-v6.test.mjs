// v6 迁移（正文入库 / 外部 mdfile / 壳行语义）→ v8（去 rel）的连续性测试。
//
// 覆盖口径：
//   ① v6：存量 id 保留、正文逐篇入库、盘上无文件的行保持空壳；
//   ② v6：外部绝对路径文件仍在 → mdfile + ref_attach(role='source')；不在 → 只留空壳；
//   ③ v8：refs.rel 被删除，地址只剩 id 与 locator（历史路径就是 locator）；
//   ④ v8：约定路径在迁移期解析成显式 ref 绑定（repo 主篇），运行时按 refId 读正文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { buildV1Sample, SAMPLE } from '../fixtures/db-samples.mjs';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/db/version.js';
import { migrate } from '../../src/core/db/migrator.js';
import { resolveRefId } from '../../src/core/attachmentdb.js';
import * as store from '../../src/modules/docs/store.js';
import { getDoc, listDocs } from '../../src/modules/docs/service.js';

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

// ref 的地址在 v8 只认 ref_<16hex>（运行时按 id 解析）
const GHOST = 'ref_1111111111111111';
const SHELL = 'ref_0000000000000000';
const EXT_OK = 'ref_2222222222222222';
const EXT_GONE = 'ref_3333333333333333';

test('v6 正文入库与壳行语义 → v8 去 rel 后按 refId 读取', async () => {
  const s = await createTestStore({ open: false, importLegacy: false });
  const oldAtt = process.env.NX_KV_ATTACHMENTS;
  const oldDocs = process.env.NX_KV_DOCS_DIR;
  process.env.NX_KV_ATTACHMENTS = join(s.appDir, 'attachments');
  process.env.NX_KV_DOCS_DIR = join(s.appDir, 'docs');
  let raw = null;
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
    raw = s.core.openRaw(s.dbPath);
    const add = (id, locator) =>
      raw.run(
        `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
         VALUES (:id, 'md', :locator, '', 0, NULL, :at, :at)`,
        { id, locator, at }
      );
    add(GHOST, 'repo/acme/ghost.md');
    add(SHELL, '');
    add(EXT_OK, extOk);
    add(EXT_GONE, extGone);

    // ── 显式迁移到 v6：此时 rel 还在，断言历史归位结果 ──
    const context = {
      attachmentsRoot: process.env.NX_KV_ATTACHMENTS,
      docsDir: process.env.NX_KV_DOCS_DIR,
      atMs: at,
    };
    migrate(raw, { to: 6, context });

    const sample = raw.get('SELECT id, rel, origin, body_bytes FROM refs WHERE locator = :loc', {
      loc: SAMPLE.docRel,
    });
    assert.equal(sample.id, 'ref_' + sha1(SAMPLE.docRel).slice(0, 16), '存量 id 不许被新公式改写');
    assert.equal(sample.rel, SAMPLE.docRel);
    assert.equal(sample.origin, 'import');
    const sampleBody = '# sample\n\n[链接](https://example.com/spec)\n';
    const body = raw.get('SELECT body, body_bytes, body_hash FROM ref_bodies WHERE ref_id = :id', {
      id: sample.id,
    });
    assert.equal(body.body, sampleBody);
    assert.equal(body.body_bytes, Buffer.byteLength(sampleBody, 'utf8'));
    assert.equal(body.body_hash, sha256(sampleBody));

    // 盘上无文件的行保持空壳（不软删、不删行）
    const ghost = raw.get('SELECT rel, origin, body_bytes, deleted_at FROM refs WHERE id = :id', {
      id: GHOST,
    });
    assert.equal(ghost.rel, 'repo/acme/ghost.md');
    assert.equal(ghost.body_bytes, 0);
    assert.equal(ghost.deleted_at, null);
    assert.equal(raw.get('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: GHOST }).c, 0);

    // 空 locator → legacy/<id>
    assert.equal(raw.get('SELECT rel FROM refs WHERE id = :id', { id: SHELL }).rel, 'legacy/' + SHELL);

    // 外部文件仍在 → mdfile + source 边；不在 → 只留空壳
    const okRel = raw.get('SELECT rel, origin FROM refs WHERE id = :id', { id: EXT_OK });
    assert.match(okRel.rel, /^external\//);
    assert.equal(okRel.origin, 'external');
    const att = raw.get("SELECT id, kind, abs_path, storage FROM attachments WHERE kind = 'mdfile'");
    assert.ok(att, '外部文件仍在必须登记 mdfile');
    assert.equal(att.storage, 'external');
    assert.equal(att.abs_path.toLowerCase(), resolve(extOk).toLowerCase());
    assert.equal(raw.get("SELECT count(*) AS c FROM ref_attach WHERE ref_id = :id AND role = 'source'", { id: EXT_OK }).c, 1);
    const gone = raw.get('SELECT rel, origin FROM refs WHERE id = :id', { id: EXT_GONE });
    assert.match(gone.rel, /^external\//);
    // 迁移证据落 meta
    const meta = JSON.parse(raw.get("SELECT value FROM meta WHERE key = 'refs_v6'").value);
    assert.equal(meta.files, 1);
    assert.equal(meta.bodies, 1);
    assert.equal(meta.relEmpty, 0);

    // ── 继续迁移到 v8：rel 列删除，地址只剩 id / locator ──
    migrate(raw, { to: CURRENT_SCHEMA_VERSION, context: { atMs: at } });

    const cols = raw.all("SELECT name FROM pragma_table_info('refs')");
    assert.ok(!cols.some((c) => c.name === 'rel'), 'v8 起 refs 不再有 rel 列');

    const v8Sample = raw.get('SELECT id, locator, origin FROM refs WHERE id = :id', { id: sample.id });
    assert.equal(v8Sample.locator, SAMPLE.docRel, '历史路径只保留在 locator（不丢）');
    assert.equal(v8Sample.origin, 'import');
    assert.equal(raw.get('SELECT body FROM ref_bodies WHERE ref_id = :id', { id: sample.id }).body, sampleBody);
    assert.equal(raw.get('SELECT locator FROM refs WHERE id = :id', { id: GHOST }).locator, 'repo/acme/ghost.md');
    assert.equal(raw.get('SELECT locator FROM refs WHERE id = :id', { id: SHELL }).locator, '');
    assert.equal(raw.get('SELECT locator FROM refs WHERE id = :id', { id: EXT_OK }).locator, extOk);

    // 约定路径（repo/<key>/…）在迁移期解析成显式绑定
    const bind = raw.get('SELECT type, repo_key, ref_id FROM ref_bindings WHERE ref_id = :id', { id: sample.id });
    assert.deepEqual(bind && [bind.type, bind.repo_key], ['repo', SAMPLE.repoKey]);

    // 身份解析：只认 id（不再按 rel: 前缀 / 路径猜）
    assert.equal(resolveRefId(raw, 'ref:' + sample.id), sample.id);
    assert.equal(resolveRefId(raw, sample.id), sample.id);
    assert.equal(resolveRefId(raw, 'rel:' + SAMPLE.docRel), null);

    raw.close();
    raw = null;

    // ── 运行时读路径：按 refId 读正文 / 区分壳行 ──
    s.db = s.core.openStore({ path: s.dbPath, appDir: s.appDir, importLegacyData: false });

    assert.equal(await store.readOwnDoc(sample.id), sampleBody);
    assert.ok(!existsSync(join(s.appDir, 'docs', 'notes', 'new.md')), '正文只存 DB，不落盘');

    const normal = await store.ownDocState(sample.id);
    assert.equal(normal.kind, 'normal');
    assert.equal(normal.hasBody, true);

    const shell = await store.ownDocState(SHELL);
    assert.equal(shell.exists, true);
    assert.equal(shell.hasBody, false);
    assert.equal(shell.kind, 'legacy');
    assert.ok(shell.reason.includes('历史'));

    await assert.rejects(() => store.readOwnDoc(SHELL), /文档不存在/);

    const got = await getDoc({ ref: 'ref:' + SHELL });
    assert.equal(got.missing, true);
    assert.equal(got.kind, 'legacy');
    assert.ok(String(got.reason || '').length > 0, 'docs get 必须说明为什么没有正文');

    const ext = await getDoc({ ref: 'ref:' + EXT_OK });
    assert.equal(ext.external, true);
    assert.match(ext.body, /外部正文/);

    const listed = await listDocs({});
    const shellItem = listed.docs.find((x) => x.refId === SHELL);
    assert.ok(shellItem, 'docs list 必须包含壳行（显式标注）');
    assert.equal(shellItem.hasBody, false);
    assert.equal(shellItem.missing, true);
    assert.equal(shellItem.docId, 'ref:' + SHELL);
    const extItem = listed.docs.find((x) => x.refId === EXT_OK);
    assert.equal(extItem.kind, 'external');
    assert.equal(extItem.hasBody, false);

    // 级联：删 refs 行 → 正文与关系一起消失
    s.db.run('DELETE FROM refs WHERE id = :id', { id: sample.id });
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: sample.id }).c, 0);
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_attach WHERE ref_id = :id', { id: sample.id }).c, 0);
  } finally {
    if (raw && !raw.closed) {
      try { raw.close(); } catch { /* 已经关了 */ }
    }
    s.reset();
    if (oldAtt === undefined) delete process.env.NX_KV_ATTACHMENTS;
    else process.env.NX_KV_ATTACHMENTS = oldAtt;
    if (oldDocs === undefined) delete process.env.NX_KV_DOCS_DIR;
    else process.env.NX_KV_DOCS_DIR = oldDocs;
  }
});
