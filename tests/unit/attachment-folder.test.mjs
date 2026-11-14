// #127 · folder 附件类型：迁移 + 登记 + 正文解析 + 提示词变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { migrate } from '../../src/core/db/migrator.js';

/** 建一份 v9 形态的最小库（只含 v10.sql 会碰到的表）。 */
function v9Store() {
  return createTestStore({ open: false, bootstrap: false });
}

test('#127 v9→v10：重建 attachments 后资源与关系表不丢，CHECK 含 folder', async () => {
  const s = await v9Store();
  const raw = s.open();
  try {
    raw.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('file','url','task','ref','mdfile')),
        name TEXT NOT NULL DEFAULT '', local_path TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
        hash TEXT NOT NULL DEFAULT '', storage TEXT NOT NULL DEFAULT '', group_id INTEGER NOT NULL DEFAULT 0,
        target_kind TEXT NOT NULL DEFAULT '' CHECK (target_kind IN ('','task','ref')),
        target_key TEXT NOT NULL DEFAULT '', target_seq INTEGER, dedupe_key TEXT NOT NULL DEFAULT '',
        meta TEXT NOT NULL DEFAULT '{}', abs_path TEXT NOT NULL DEFAULT '', anchor_dir TEXT NOT NULL DEFAULT '',
        missing_at INTEGER, last_seen_at INTEGER, deleted_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE task_attach (task_id INTEGER, attachment_id TEXT, role TEXT, position INTEGER, note TEXT, created_at INTEGER);
      CREATE TABLE ref_attach (ref_id TEXT, attachment_id TEXT, role TEXT, position INTEGER, note TEXT, created_at INTEGER);
      PRAGMA user_version = 9;
    `);
    const at = Date.now();
    raw.run(
      `INSERT INTO attachments (id, kind, name, local_path, created_at, updated_at)
       VALUES ('att_file_x', 'file', 'a.png', 'D:/tmp/a.png', :at, :at)`,
      { at },
    );
    raw.run("INSERT INTO task_attach VALUES (1, 'att_file_x', 'inline', 0, '', :at)", { at });
    raw.run("INSERT INTO ref_attach VALUES ('ref_1', 'att_file_x', 'inline', 0, '', :at)", { at });

    assert.deepEqual(migrate(raw, { from: 9, to: 10 }), [10]);
    assert.equal(raw.get('PRAGMA user_version').user_version, 10);
    assert.equal(raw.get('SELECT count(*) c FROM attachments').c, 1);
    assert.equal(raw.get('SELECT name FROM attachments').name, 'a.png');
    assert.equal(raw.get('SELECT count(*) c FROM task_attach').c, 1);
    assert.equal(raw.get('SELECT count(*) c FROM ref_attach').c, 1);

    raw.run(
      `INSERT INTO attachments (id, kind, name, abs_path, storage, created_at, updated_at)
       VALUES ('att_folder_x', 'folder', 'design', 'D:/tmp/design', 'external', :at, :at)`,
      { at },
    );
    assert.equal(raw.get("SELECT kind FROM attachments WHERE id='att_folder_x'").kind, 'folder');
    assert.throws(
      () => raw.run(`INSERT INTO attachments (id, kind, name, created_at, updated_at) VALUES ('bad', 'weird', '', :at, :at)`, { at }),
      /CHECK|constraint/i,
    );
  } finally {
    s.reset();
  }
});

test('#127 文件夹登记：只存路径、不复制内容，正文可解析，模板 ctx 有 folder.*', async () => {
  const s = await createTestStore();
  try {
    const root = mkdtempSync(join(tmpdir(), 'nx-kv-folder-'));
    const dir = join(root, 'design');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '# A', 'utf8');

    const { registerFolder, folderAttachmentId, parseAttachmentRefs } = await import('../../src/core/attachmentdb.js');
    const rec = registerFolder(s.db, { path: dir, name: '设计稿目录' });
    assert.equal(rec.id, folderAttachmentId(dir));
    assert.equal(rec.name, '设计稿目录');
    const row = s.db.get('SELECT * FROM attachments WHERE id = :id', { id: rec.id });
    assert.equal(row.kind, 'folder');
    assert.equal(row.storage, 'external');
    assert.equal(row.abs_path, dir);
    assert.equal(row.size, 0, '文件夹没有字节');
    assert.equal(row.hash, '');

    // 同一路径幂等（唯一索引 + ON CONFLICT）
    const again = registerFolder(s.db, { path: dir, name: '设计稿目录' });
    assert.equal(again.id, rec.id);

    // 正文里的 nxkv://folder/<id> 能被解析回 folder 类型
    const refs = parseAttachmentRefs(`[设计稿目录](nxkv://folder/${rec.id})`);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, 'folder');

    // 模板 ctx：kindLabel / folder 子对象 / usage
    const { attachmentInstruction, attachTemplateCtx } = await import('../../src/modules/tasktool/attach-template.js');
    const item = {
      id: rec.id, kind: 'folder', kindLabel: '文件夹', name: '设计稿目录',
      absPath: dir, exists: true, missing: false, role: 'inline', note: '',
      usage: `这是本地文件夹的路径指针：先列目录 ${dir} 看结构，再用 Read 读需要的文件`,
      readCmd: `nx-kv file content ${rec.id}`,
    };
    const ctx = attachTemplateCtx([item]).attach.list[0];
    assert.equal(ctx.kind, 'folder');
    assert.equal(ctx.folder.absPath, dir);
    assert.equal(ctx.folder.exists, true);
    const out = attachmentInstruction([item]);
    assert.match(out, /文件夹/);
    assert.ok(out.includes(dir), '模板必须把文件夹绝对路径给到 agent');
    assert.match(out, /先列目录/);
  } finally {
    s.reset();
  }
});
