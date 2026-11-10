// 全量导入（JSON → SQLite）· 生命周期：
// 幂等、失败回滚、dry-run、legacy 文件改名保留、并发首启、不删别人的库、verify 对账。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestStore, readFixtureJson } from '../support/test-store.mjs';
import { BIN, execFileAsync, importFixture } from '../support/legacy-import.mjs';

test('幂等：第二次 bootstrap 不重复插入、不报错，行数不变', async () => {
  const s = await importFixture();
  try {
    const before = s.db.get('SELECT count(*) AS c FROM tasks').c;
    const metaBefore = s.db.get("SELECT value FROM meta WHERE key = 'migrated_from_json_at'").value;
    s.core.closeDb();
    s.open();
    assert.equal(s.db.get('SELECT count(*) AS c FROM tasks').c, before);
    assert.equal(s.db.get("SELECT value FROM meta WHERE key = 'migrated_from_json_at'").value, metaBefore);
    assert.equal(s.core.getBootstrapResult().action, 'none');
  } finally {
    s.reset();
  }
});

test('失败可回滚：JSON 一字节不动、库文件被清掉、写失败日志（退出码 2 由 CLI 映射）', async () => {
  const s = await createTestStore({ open: false });
  try {
    const data = readFixtureJson('legacy-json/localtasks.json');
    // 人为把两条任务的 id 改成一样：seq 无法一一对应 → 整体拒绝
    data.topics.legacyhash0000001.tasks[1].id = data.topics.legacyhash0000001.tasks[0].id;
    s.seedLegacy({ localtasks: data });
    const before = readFileSync(join(s.appDir, 'localtasks.json'), 'utf8');

    assert.throws(() => s.open(), (err) => {
      assert.equal(err.name, 'StoreMigrationError');
      assert.equal(err.code, 'STORE_MIGRATION_FAILED');
      assert.match(err.message, /迁移失败，已回滚/);
      assert.ok(err.details.logPath, '失败信息里必须给出日志路径');
      return true;
    });

    assert.equal(readFileSync(join(s.appDir, 'localtasks.json'), 'utf8'), before, 'legacy JSON 必须一字节不动');
    assert.equal(existsSync(s.dbPath), false, '本次新建的库文件必须被清掉（可重建）');
    const logs = readdirSync(s.appDir).filter((f) => f.startsWith('migration-failed-'));
    assert.equal(logs.length, 1, '必须留下失败明细日志');
  } finally {
    s.reset();
  }
});

test('dry-run：动作全跑完但库里什么都不留，legacy JSON 不改名', async () => {
  const s = await createTestStore({ open: false });
  try {
    s.seedFixtureDir();
    const { openAndBootstrap } = await import('../../src/core/db/bootstrap.js');
    const out = openAndBootstrap({
      path: s.dbPath,
      appDir: s.appDir,
      importLegacyData: true,
      dryRun: true,
    });
    assert.equal(out.result.action, 'imported', '演练也要真的跑一遍导入');
    assert.equal(out.result.report.imported.tasks, 9);
    // 连建表也一起回滚了：库里一张表都不该留下（"演练"的含义就是什么都没发生）
    const tables = out.db.get("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'");
    out.db.close();
    assert.equal(tables.c, 0, 'ROLLBACK 后没有表');
    assert.equal(existsSync(join(s.appDir, 'localtasks.json')) && true, true, 'dry-run 不改名任何文件');
  } finally {
    s.reset();
  }
});

test('迁移成功后 legacy JSON 改名保留（不删），但 config.json 留在原地（凭据仍在用）', async () => {
  const s = await importFixture();
  try {
    const { archiveLegacyFiles } = await import('../../src/core/db/bootstrap.js');
    const out = archiveLegacyFiles(s.appDir, 1_800_000_000_000);
    const names = readdirSync(s.appDir).sort();
    assert.ok(names.includes('config.json'), 'config.json 不能改名（改名等于把用户登出）');
    assert.ok(names.some((n) => /^localtasks\.migrated-.*\.json$/.test(n)));
    assert.ok(names.some((n) => /^repos\.migrated-.*\.json$/.test(n)));
    assert.equal(out.renamed.length, 2, 'localtasks + repos');
    assert.ok(!names.includes('localtasks.json'), '主文件已改名，再跑一次迁移物理上不可能');
  } finally {
    s.reset();
  }
});

test('两个进程同时 db migrate：只有一个真正导入，最终状态一致', async () => {
  const s = await createTestStore({ open: false });
  try {
    s.seedFixtureDir();
    s.core.closeDb();
    const run = () =>
      execFileAsync(process.execPath, [BIN, 'db', 'migrate', '--apply', '--json'], {
        env: { ...process.env, NX_KV_HOME: s.appDir, NX_KV_DB: s.dbPath },
        encoding: 'utf8',
      });
    const [a, b] = await Promise.all([run().catch((e) => e), run().catch((e) => e)]);
    const parsed = [a, b].map((r) => {
      assert.ok(r.stdout, `子进程没有输出（stderr: ${r.stderr || ''}）`);
      return JSON.parse(r.stdout);
    });
    const actions = parsed.map((p) => p.action);
    const diag = JSON.stringify(
      parsed.map((p, i) => ({
        action: p.action,
        error: p.error,
        code: p.code,
        stderr: String([a, b][i].stderr || '').slice(0, 400),
      }))
    );
    assert.equal(actions.filter((x) => x === 'imported').length, 1, diag);
    assert.ok(
      actions.every((x) => x === 'imported' || x === 'none' || x === 'raced'),
      diag
    );

    s.open();
    assert.equal(s.db.get('SELECT count(*) AS c FROM tasks').c, 9, '最终只有一份数据');
    assert.equal(s.db.get('SELECT count(*) AS c FROM topics').c, 3);
  } finally {
    s.reset();
  }
});

test('失败时**不删**别人的库：已有 schema 的库只回滚事务，文件与结构原样保留', async () => {
  const s = await createTestStore();
  try {
    // 库已经建好（模拟另一个进程刚建完，或用户已在使用）
    s.db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES ('keep.me', 'repo', '', '', '', '', 0, '{}', '', 0, NULL, 1, 1)`
    );
    s.core.closeDb();

    const data = readFixtureJson('legacy-json/localtasks.json');
    data.topics.legacyhash0000001.tasks[1].id = data.topics.legacyhash0000001.tasks[0].id;
    s.seedLegacy({ localtasks: data });

    assert.throws(() => s.open(), /迁移失败|id 1 重复/);

    // 用只读连接验（不能再 openStore：它会再跑一次同样的导入、同样失败 —— 这是刻意的：
    // 坏数据不能让程序悄悄"跳过导入"继续跑）
    const probe = s.core.openRaw(s.dbPath, { readOnly: true });
    try {
      assert.equal(
        probe.get("SELECT count(*) AS c FROM repos WHERE key = 'keep.me'").c,
        1,
        '原有仓库必须还在（哨兵 __unbound__ 由 bootstrap 创建，另算）'
      );
      assert.equal(probe.get('SELECT count(*) AS c FROM tasks').c, 0, '本次导入整体回滚');
      assert.equal(probe.get("SELECT value FROM meta WHERE key = 'store_kind'").value, 'sqlite');
    } finally {
      probe.close();
    }
  } finally {
    s.reset();
  }
});

test('dry-run 遇到 schema 升级直接拒绝（升级逐步提交，无法整体回滚）', async () => {
  const s = await createTestStore();
  try {
    s.db.exec('PRAGMA user_version = 0'); // 造出"库比程序旧"的状态
    s.core.closeDb();
    assert.throws(
      () => s.core.openStore({ path: s.dbPath, appDir: s.appDir, dryRun: true, importLegacyData: true }),
      /--dry-run 不支持 schema 升级/
    );
  } finally {
    s.reset();
  }
});

test('verify：跑完导入后 db verify 全过（含逐条 body 哈希对账）', async () => {
  const s = await importFixture();
  try {
    const { verifyStore } = await import('../../src/core/db/verify.js');
    const out = verifyStore(s.db, { appDir: s.appDir });
    assert.equal(out.ok, true, out.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('\n'));
    assert.equal(out.counts.tasks, 9);
    assert.deepEqual(out.distribution, { pending: 3, claimed: 1, done: 4, cancelled: 1 });
  } finally {
    s.reset();
  }
});
