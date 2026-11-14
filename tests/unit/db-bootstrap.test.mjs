// 库的建立与版本判定：fresh / 空文件 / 正常 / 过新 / 不是我们的库（5 种矩阵）+
// schema 约束（UNIQUE / CHECK / 触发器 / 外键）+ 连接级 PRAGMA + 启动期 warning 抑制。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTestStore, assertUnderTmp } from '../support/test-store.mjs';
import { tmpdir } from 'node:os';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/db/version.js';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'kv.mjs');

const tablesOf = (db) =>
  db
    .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((r) => r.name);

test(`全新目录：建 19 张表 / user_version=${CURRENT_SCHEMA_VERSION} / meta 三件套齐全`, async () => {
  const s = await createTestStore();
  try {
    const tables = tablesOf(s.db);
    // 001 的 16 张 + v2 新增 attachments / task_attach / ref_attach − 删除 task_refs / ref_relations
    // （v3 只给 templates 加列；v4 新增 group_refs；v6 新增 ref_bodies）
    assert.equal(tables.length, 19, `实际: ${tables.join(',')}`);
    for (const t of [
      'meta', 'settings', 'topics', 'tasks', 'repos', 'refs', 'templates', 'goals',
      'attachments', 'task_attach', 'ref_attach', 'group_refs', 'ref_bodies',
    ]) {
      assert.ok(tables.includes(t), `缺表 ${t}`);
    }
    for (const t of ['task_refs', 'ref_relations']) {
      assert.ok(!tables.includes(t), `v2 必须删掉旧表 ${t}`);
    }
    assert.equal(s.db.get('PRAGMA user_version').user_version, CURRENT_SCHEMA_VERSION);

    const meta = Object.fromEntries(s.db.all('SELECT key, value FROM meta').map((r) => [r.key, r.value]));
    assert.equal(meta.store_kind, 'sqlite');
    assert.equal(meta.schema_version, String(CURRENT_SCHEMA_VERSION));
    assert.match(meta.created_by, /^nx-kv\//);
    assert.equal(meta.migrated_from_json_at, undefined, '全新库不该有"从 JSON 迁来"的标志');

    // 索引与触发器数量（27 索引 / 1 触发器；v5 新增 ux_attachments_mdfile_path，v10 新增 ux_attachments_folder_path，
    // v6 新增 ux_refs_rel）
    const idx = s.db.get(
      "SELECT count(*) AS c FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
    );
    assert.equal(idx.c, 27);
    const trg = s.db.get("SELECT count(*) AS c FROM sqlite_master WHERE type = 'trigger'");
    assert.equal(trg.c, 1);
  } finally {
    s.reset();
  }
});

test('空文件（0 字节）当全新建库，不当"别人的库"', async () => {
  const s = await createTestStore({ open: false });
  try {
    writeFileSync(s.dbPath, '');
    s.open();
    assert.equal(s.core.inspectStore(s.db).storeKind, 'sqlite');
    assert.equal(tablesOf(s.db).length, 19);
  } finally {
    s.reset();
  }
});

test('有表但没有 store_kind → 拒绝（不自动建表，不动别人的库）', async () => {
  const s = await createTestStore({ open: false });
  try {
    // 手工造一个"其它 SQLite 文件被改名成 nxkv.db"的场景
    const { openRaw } = s.core;
    const raw = openRaw(s.dbPath);
    raw.exec('CREATE TABLE something (a INTEGER)');
    raw.close();

    assert.throws(() => s.open(), (err) => {
      assert.equal(err.name, 'NotNxKvStoreError');
      assert.match(err.message, /缺 meta\.store_kind/);
      return true;
    });
    // 原文件没被改：还是只有那一张表
    const check = openRaw(s.dbPath, { readOnly: true });
    try {
      assert.deepEqual(
        check.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name),
        ['something']
      );
    } finally {
      check.close();
    }
  } finally {
    s.reset();
  }
});

test('库比程序新（user_version > CURRENT）→ 拒绝且不写任何东西', async () => {
  const s = await createTestStore();
  try {
    s.db.exec('PRAGMA user_version = 99');
    s.core.closeDb();
    assert.throws(() => s.open(), (err) => {
      assert.equal(err.name, 'StoreTooNewError');
      assert.match(err.message, /升级 nx-kv/);
      return true;
    });
    // 版本号没被"降级"回去
    const again = s.core.openRaw(s.dbPath, { readOnly: true });
    try {
      assert.equal(again.get('PRAGMA user_version').user_version, 99);
    } finally {
      again.close();
    }
  } finally {
    s.reset();
  }
});

test('只读连接不会建表（诊断命令不该改库）', async () => {
  const s = await createTestStore({ open: false });
  try {
    writeFileSync(s.dbPath, ''); // 空文件：只读打开不会报错，也不会建任何表
    s.open({ readOnly: true });
    assert.equal(tablesOf(s.db).length, 0);
  } finally {
    s.reset();
  }
});

test('只读打开一个不存在的库 → 明确报"库文件不存在"，不是 SQLite 的英文报错', async () => {
  const s = await createTestStore({ open: false });
  try {
    assert.throws(() => s.open({ readOnly: true }), /库文件不存在/);
  } finally {
    s.reset();
  }
});

test('重复 bootstrap 是空转（幂等：不重建表、不改 meta）', async () => {
  const s = await createTestStore();
  try {
    const before = s.db.get("SELECT updated_at FROM meta WHERE key = 'store_kind'").updated_at;
    s.insertedBefore = s.db.get('SELECT count(*) AS c FROM settings').c;
    s.core.closeDb();
    const result = s.core.getBootstrapResult();
    void result;
    s.open();
    assert.equal(s.db.get("SELECT updated_at FROM meta WHERE key = 'store_kind'").updated_at, before);
    assert.equal(s.db.get('SELECT count(*) AS c FROM settings').c, s.insertedBefore);
  } finally {
    s.reset();
  }
});

test('连接级 PRAGMA 生效：WAL + foreign_keys=ON + busy_timeout', async () => {
  const s = await createTestStore();
  try {
    assert.equal(s.db.get('PRAGMA journal_mode').journal_mode, 'wal');
    assert.equal(s.db.get('PRAGMA foreign_keys').foreign_keys, 1);
    assert.equal(s.db.get('PRAGMA busy_timeout').timeout, 5000);
  } finally {
    s.reset();
  }
});

test('schema 约束：topics.key UNIQUE / repos.ext 必须 JSON 对象 / 外键生效', async () => {
  const s = await createTestStore();
  try {
    const insertRepo = (key, ext = '{}') =>
      s.db.run(
        `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                            deleted_at, created_at, updated_at)
         VALUES (:k, 'repo', '', '', '', '', 0, :ext, '', 0, NULL, 1, 1)`,
        { k: key, ext }
      );
    const insertTopic = (key, repo) =>
      s.db.run(
        `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                             deleted_at, created_at, updated_at)
         VALUES (:k, :r, :cwd, NULL, '', 1, '{}', '', 0, NULL, 1, 1)`,
        { k: key, r: repo, cwd: key }
      );

    // 外键：topic 指向不存在的 repo → 拒绝（证明 PRAGMA foreign_keys 真的开了）
    assert.throws(() => insertTopic('t1', 'nope'), /外键约束|FOREIGN KEY/);

    insertRepo('r1');
    insertTopic('t1', 'r1');
    assert.throws(() => insertTopic('t1', 'r1'), /唯一约束|UNIQUE/);

    // repos.ext 必须是 JSON 对象（数组/字符串都拒）
    assert.throws(() => insertRepo('r2', '[]'), /constraint|CHECK/i);
    assert.throws(() => insertRepo('r3', 'not-json'), /constraint|CHECK/i);

    // 触发器：身份（seq / created_at）不可改
    s.db.run(
      `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                          from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                          created_at, updated_at)
       VALUES ((SELECT id FROM topics WHERE key = 't1'), 1, '', 'pending', 0, 'x', '{}', '', NULL,
               '', 0, NULL, NULL, 1, NULL, 100, 100)`
    );
    assert.throws(() => s.db.run('UPDATE tasks SET seq = 2 WHERE seq = 1'), /任务身份不可修改/);
    assert.throws(() => s.db.run('UPDATE tasks SET created_at = 200 WHERE seq = 1'), /任务身份不可修改/);
    // 正文与状态可改（只有身份不可改）
    s.db.run("UPDATE tasks SET body = 'y', status = 'claimed' WHERE seq = 1");
    assert.equal(s.db.get('SELECT body FROM tasks WHERE seq = 1').body, 'y');
  } finally {
    s.reset();
  }
});

test('Node 版本硬拦：< 22.13 给出人话错误，不是 ERR_UNKNOWN_BUILTIN_MODULE', async () => {
  const { checkNodeVersion } = await import('../../src/core/db/version.js');
  assert.equal(checkNodeVersion('22.13.0').ok, true);
  assert.equal(checkNodeVersion('22.22.2').ok, true);
  const old = checkNodeVersion('20.11.0');
  assert.equal(old.ok, false);
  assert.match(old.message, /需要 Node >= 22\.13\.0（当前 20\.11\.0）/);
  assert.match(old.message, /node:sqlite|内置 SQLite/);
});

test('CLI 任何子命令的 stderr 里都没有 ExperimentalWarning', async () => {
  const dir = assertUnderTmp(join(tmpdir(), `nx-kv-warn-${process.pid}-${Date.now()}`));
  mkdirSync(dir, { recursive: true });
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, 'version'], {
      env: { ...process.env, NX_KV_HOME: dir },
      encoding: 'utf8',
    });
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
    assert.equal(stderr.trim(), '', `stderr 必须干净，实际: ${stderr}`);
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('helper 的硬保险：非临时目录直接抛错', async () => {
  assert.throws(() => assertUnderTmp(join(ROOT, 'nxkv.db')), /拒绝在非临时目录建库/);
  // 同目录下的兄弟路径不能靠 startsWith 蒙过去
  assert.throws(() => assertUnderTmp(tmpdir() + '-evil'), /拒绝在非临时目录建库/);
});

test('库文件里的 PRAGMA 头被 migrator 过滤（DDL 里不能有 journal_mode）', async () => {
  const { ddlOf, readSchemaSql } = await import('../../src/core/db/migrator.js');
  const raw = readSchemaSql('v1.sql');
  assert.match(raw, /PRAGMA journal_mode = WAL/, 'schema 文件里保留 PRAGMA 头（供人阅读）');
  const ddl = ddlOf(raw);
  assert.doesNotMatch(ddl, /^PRAGMA\s+journal_mode/im);
  assert.doesNotMatch(ddl, /^PRAGMA\s+user_version/im);
  // 正文里的表定义一条都不能少
  for (const t of ['topics', 'tasks', 'repos', 'meta', 'settings']) {
    assert.match(ddl, new RegExp(`CREATE TABLE ${t} `));
  }
});

test('schema 文件随包发布（src/ 在 files 白名单里）', async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('src/'), 'files 白名单必须包含 src/，否则安装后读不到 schema');
  assert.ok(readFileSync(join(ROOT, 'src/core/db/migrations/v1.sql'), 'utf8').length > 10_000);
});
