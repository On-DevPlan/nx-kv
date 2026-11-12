// 版本样本库迁移测试：v1 → 当前版本，数据条数与关键字段必须对得上。
//
// 这是「历史版本可测试」的最小机制：样本库由 tests/fixtures/db-samples.mjs
// 构造（不提交二进制），任意历史版本都应该能在同一套夹具上加一条构造脚本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { buildV1Sample, SAMPLE } from '../fixtures/db-samples.mjs';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/db/version.js';
import {
  describeEdges,
  planMigrationPath,
} from '../../src/core/db/migrations/index.js';

test('迁移映射表：直接边 / 组合边 / 缺边与降级都要明确报错', () => {
  assert.deepEqual(
    planMigrationPath(1, 2).map((s) => `${s.from}->${s.to}`),
    ['1->2']
  );
  assert.deepEqual(
    planMigrationPath(0, CURRENT_SCHEMA_VERSION).map((s) => `${s.from}->${s.to}`),
    ['0->1', '1->2', '2->3', '3->4', '4->5', '5->6']
  );
  const composed = describeEdges().find((e) => e.from === 0 && e.to === 2);
  assert.ok(composed, '0→2 组合边必须显式登记');
  assert.equal(composed.kind, 'composed');
  assert.deepEqual(composed.via, [0, 1, 2]);
  assert.throws(() => planMigrationPath(2, 1), /不支持降级/);
  assert.throws(() => planMigrationPath(6, 7), /缺少迁移边/);
});

test('v1 样本库 → 当前版本：条数与关键字段正确、可重复', async () => {
  const s = await createTestStore({ open: false, importLegacy: false });
  const oldAtt = process.env.NX_KV_ATTACHMENTS;
  const oldDocs = process.env.NX_KV_DOCS_DIR;
  process.env.NX_KV_ATTACHMENTS = join(s.appDir, 'attachments');
  process.env.NX_KV_DOCS_DIR = join(s.appDir, 'docs');
  try {
    buildV1Sample(s);
    s.db = s.core.openStore({ path: s.dbPath, appDir: s.appDir, importLegacyData: false });

    assert.equal(s.db.get('PRAGMA user_version').user_version, CURRENT_SCHEMA_VERSION);
    for (const t of ['attachments', 'task_attach', 'ref_attach']) {
      assert.ok(s.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=:t", { t }), `缺表 ${t}`);
    }
    for (const t of ['task_refs', 'ref_relations']) {
      assert.ok(!s.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=:t", { t }), `旧表应删除 ${t}`);
    }

    // 资源：报表文件 + manifest 孤儿 + URL + 内部任务引用 = 4
    assert.equal(s.db.get('SELECT count(*) AS c FROM attachments').c, 4);
    // 关系：任务 1 的 fileId 去重后 1 条 + URL 1 条；任务 2 的内部任务引用 1 条
    assert.equal(s.db.get('SELECT count(*) AS c FROM task_attach').c, 3);
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM task_attach WHERE attachment_id = :id", { id: SAMPLE.fileId }).c,
      1,
      '同一正文里出现两次的 fileId 必须合并成一条关系'
    );
    // 文档：md 里的 URL 落 reference 边
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_attach').c, 1);

    // manifest 里有、正文没引用的文件 → 无关系资源（孤儿），不能误挂到任务上
    assert.equal(
      s.db.get('SELECT count(*) AS c FROM task_attach WHERE attachment_id = :id', { id: SAMPLE.orphanId }).c,
      0
    );
    assert.ok(s.db.get('SELECT id FROM attachments WHERE id = :id', { id: SAMPLE.orphanId }), '孤儿资源行应保留');

    const file = s.db.get('SELECT local_path, storage, size FROM attachments WHERE id = :id', { id: SAMPLE.fileId });
    assert.ok(existsSync(file.local_path), `manifest 迁移的 local_path 必须真实存在: ${file.local_path}`);
    assert.equal(file.storage, 'local');
    assert.equal(file.size, 12);

    // 文档树被登记（refs 至少包含样本 md）
    assert.ok(
      s.db.get('SELECT id FROM refs WHERE locator = :loc', { loc: SAMPLE.docRel }),
      'docs 树里的 md 必须迁进 refs'
    );

    // 再跑一次：幂等（user_version 已是最新 → 无新步骤，数据不变）
    const before = [
      s.db.get('SELECT count(*) AS c FROM attachments').c,
      s.db.get('SELECT count(*) AS c FROM task_attach').c,
      s.db.get('SELECT count(*) AS c FROM ref_attach').c,
    ];
    s.core.closeDb();
    s.db = s.core.openStore({ path: s.dbPath, appDir: s.appDir, importLegacyData: false });
    const after = [
      s.db.get('SELECT count(*) AS c FROM attachments').c,
      s.db.get('SELECT count(*) AS c FROM task_attach').c,
      s.db.get('SELECT count(*) AS c FROM ref_attach').c,
    ];
    assert.deepEqual(after, before, '重复迁移必须幂等');
  } finally {
    s.reset();
    if (oldAtt === undefined) delete process.env.NX_KV_ATTACHMENTS;
    else process.env.NX_KV_ATTACHMENTS = oldAtt;
    if (oldDocs === undefined) delete process.env.NX_KV_DOCS_DIR;
    else process.env.NX_KV_DOCS_DIR = oldDocs;
  }
});
