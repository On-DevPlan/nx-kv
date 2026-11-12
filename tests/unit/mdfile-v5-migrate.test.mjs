// v5 迁移：attachments 的 12-step 重建必须逐行保住资源与关系。
//
// 为什么单独测 v5（而不是只测 v1 → 当前版本）：
//   重建表最坏的失败模式是「数据在升级时静默丢行」——v1 样本只有 3 条关系，
//   看不出 DROP→RENAME 窗口里外键悬空的影响。这里把库停在 v4、堆到 87 条
//   task_attach（与真实库同规模）再做 4→5，逐行比对前后快照。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { buildV1Sample } from '../fixtures/db-samples.mjs';
import { migrate } from '../../src/core/db/migrator.js';

const AT = Date.UTC(2026, 10, 12, 6, 0, 0);
const OLD_COLS = [
  'id', 'kind', 'name', 'local_path', 'url', 'mime', 'size', 'hash', 'storage',
  'group_id', 'target_kind', 'target_key', 'target_seq', 'dedupe_key', 'meta',
  'deleted_at', 'created_at', 'updated_at',
];
const REL_COLS = 'task_id, attachment_id, role, position, note, created_at';

test('v5 重建 attachments：87 条关系逐行保留、旧字段不变、新约束生效', async () => {
  const s = await createTestStore({ open: false, importLegacy: false });
  try {
    buildV1Sample(s);
    const db = s.core.openRaw(s.dbPath);
    migrate(db, {
      from: 1,
      to: 4,
      context: { attachmentsRoot: join(s.appDir, 'attachments'), docsRoot: join(s.appDir, 'docs'), atMs: AT },
    });
    assert.equal(db.get('PRAGMA user_version').user_version, 4, '前置：库必须停在 v4');

    // 补规模：38 条任务 + 15 条资源，凑出 87 条 task_attach
    const topicId = db.get('SELECT id FROM topics LIMIT 1').id;
    for (let seq = 3; seq <= 40; seq++) {
      db.run(
        'INSERT INTO tasks (topic_id, seq, body, created_at, updated_at) VALUES (:t, :s, :b, :at, :at)',
        { t: topicId, s: seq, b: `# 任务 ${seq}`, at: AT }
      );
    }
    for (let i = 1; i <= 15; i++) {
      const id = 'att_url_' + String(i).padStart(16, '0');
      db.run(
        `INSERT INTO attachments (id, kind, name, url, size, storage, created_at, updated_at)
         VALUES (:id, 'url', :name, :url, 0, '', :at, :at)`,
        { id, name: `链接 ${i}`, url: `https://example.com/${i}`, at: AT }
      );
    }

    const tasks = db.all('SELECT id FROM tasks ORDER BY id');
    const atts = db.all('SELECT id FROM attachments ORDER BY id');
    const existing = new Set(
      db.all('SELECT task_id, attachment_id FROM task_attach').map((r) => `${r.task_id}:${r.attachment_id}`)
    );
    let n = existing.size;
    outer: for (const t of tasks) {
      for (const a of atts) {
        if (n >= 87) break outer;
        if (existing.has(`${t.id}:${a.id}`)) continue;
        db.run(
          `INSERT INTO task_attach (${REL_COLS}) VALUES (:t, :a, :role, :pos, :note, :at)`,
          {
            t: t.id,
            a: a.id,
            role: ['inline', 'attach', 'doc'][n % 3],
            pos: n,
            note: n % 5 === 0 ? `说明 ${n}` : '',
            at: AT,
          }
        );
        n += 1;
      }
    }
    assert.equal(db.get('SELECT count(*) AS c FROM task_attach').c, 87);

    const beforeTaskAttach = db.all(`SELECT ${REL_COLS} FROM task_attach ORDER BY task_id, attachment_id`);
    const beforeRefAttach = db.all(`SELECT ${REL_COLS.replace('task_id', 'ref_id')} FROM ref_attach ORDER BY ref_id, attachment_id`);
    const beforeAtt = db.all(`SELECT ${OLD_COLS.join(', ')} FROM attachments ORDER BY id`);
    assert.equal(beforeAtt.length, 19, '4（样本）+ 15（补齐）');
    assert.ok(beforeRefAttach.length >= 1, 'v1 样本的文档引用必须在 ref_attach 里');

    // 4 → 5：唯一的检查点就是这张表被重建过
    migrate(db, { from: 4, to: 5 });
    assert.equal(db.get('PRAGMA user_version').user_version, 5);

    assert.deepEqual(
      db.all(`SELECT ${REL_COLS} FROM task_attach ORDER BY task_id, attachment_id`),
      beforeTaskAttach,
      'task_attach 必须逐行一致（defer_foreign_keys 生效，重建窗口不丢行）'
    );
    assert.deepEqual(
      db.all(`SELECT ${REL_COLS.replace('task_id', 'ref_id')} FROM ref_attach ORDER BY ref_id, attachment_id`),
      beforeRefAttach,
      'ref_attach 同样逐行一致'
    );
    assert.deepEqual(
      db.all(`SELECT ${OLD_COLS.join(', ')} FROM attachments ORDER BY id`),
      beforeAtt,
      'attachments 旧字段必须逐行一致（迁移只补新列默认值）'
    );
    const blank = db.get(
      `SELECT count(*) AS c FROM attachments
        WHERE abs_path <> '' OR anchor_dir <> '' OR missing_at IS NOT NULL OR last_seen_at IS NOT NULL`
    );
    assert.equal(blank.c, 0, '旧行的 4 个新列必须是空值');

    // 外键在 COMMIT 后必须全部成立（这是 12-step 的核心风险点）
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);

    // 索引全量重建
    const idx = new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name));
    for (const name of [
      'ux_attachments_dedupe',
      'ix_attachments_kind',
      'ix_attachments_target',
      'ix_attachments_group',
      'ux_attachments_mdfile_path',
    ]) {
      assert.ok(idx.has(name), `缺索引 ${name}`);
    }

    // 新 CHECK：kind / storage 白名单
    assert.throws(
      () => db.run("INSERT INTO attachments (id, kind, created_at, updated_at) VALUES ('bad-kind', 'video', 1, 1)"),
      /CHECK/
    );
    assert.throws(
      () => db.run("INSERT INTO attachments (id, kind, storage, created_at, updated_at) VALUES ('bad-storage', 'file', 'weird', 1, 1)"),
      /CHECK/
    );
    db.run(
      `INSERT INTO attachments (id, kind, name, storage, abs_path, anchor_dir, created_at, updated_at)
       VALUES ('att_mdfile_ok', 'mdfile', 'ok.md', 'external', 'D:/ext/ok.md', 'D:/ext', 1, 1)`
    );

    // mdfile 路径唯一（COLLATE NOCASE）：同一文件大小写变体不得起第二行
    assert.throws(
      () => db.run(
        `INSERT INTO attachments (id, kind, name, storage, abs_path, anchor_dir, created_at, updated_at)
         VALUES ('att_mdfile_dup', 'mdfile', 'OK.md', 'external', 'd:/EXT/ok.md', 'd:/EXT', 1, 1)`
      ),
      /唯一约束|UNIQUE/
    );

    // 重复跑 4→5 是空操作（快照不可变 + user_version 双检）
    const stable = db.get('SELECT count(*) AS c FROM attachments').c;
    migrate(db, { from: 4, to: 5 });
    assert.equal(db.get('SELECT count(*) AS c FROM attachments').c, stable);
  } finally {
    s.reset();
  }
});
