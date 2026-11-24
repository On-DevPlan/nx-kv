import {
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestStore,
  readFixtureJson,
} from '../support/test-store.mjs';
import {
  importFixture,
  BIN,
  execFileAsync,
} from '../support/legacy-import.mjs';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
test('templates.json 导入：values→vars、id 原样、defaultId→is_default；文件缺失 → 只有内置', async () => {
  const s = await createTestStore({ open: false });
  s.seedLegacy({
    templates: {
      version: 1,
      defaultId: 't_custom',
      templates: [
        // 内置行也走导入（legacy store 里的 builtin 会被 JSON 归一化补回）——
        // 用户的槽位值原样带走，seed 的 INSERT OR IGNORE 不会覆盖它
        { id: 'default', name: '默认模板', body: '# 内置骨架\n\n{{背景}}', values: { 背景: '用户改过的背景' }, builtin: true },
        { id: 't_custom', name: '自定义', body: '# 自定义', values: { 目标: '做点事' } },
      ],
    },
  });
  s.open();
  try {
    const rows = s.db.all('SELECT id, category, is_default, builtin, vars, body FROM templates ORDER BY id');
    const byId = new Map(rows.map((r) => [r.id, r]));
    // 全新库路径：bootstrap 先跑 importLegacy 再 seed 内置 —— legacy 的 builtin 行
    // 先落库，seed（OR IGNORE）不会用出厂文本覆盖用户的槽位值。
    assert.ok(byId.has('default') && byId.has('t_custom'), 'legacy id 原样保留（就是稳定 key）');
    const def = byId.get('default');
    assert.equal(def.category, 'newtask', 'legacy 只有新建骨架一种用途 → newtask');
    assert.equal(def.builtin, 1);
    assert.equal(def.body, '# 内置骨架\n\n{{背景}}', 'legacy 的 builtin 正文原样进来');
    assert.equal(JSON.parse(def.vars).背景, '用户改过的背景', 'values → vars 原样');
    const custom = byId.get('t_custom');
    assert.equal(custom.is_default, 1, 'defaultId → is_default 列');
    assert.equal(def.is_default, 0, '默认只有一个（ux_templates_default 的约束语义）');
    // 报告对账
    const report = s.core.getBootstrapResult().report;
    assert.equal(report.imported.templates, 2);
  } finally {
    s.reset();
  }

  // 文件不存在：全新库 → 只有 bootstrap seed 的内置任务模板（#191 起只 newtask 一类；
  // delivery/enhance/context 是提示词段，走 promptplug 独立引擎，不再占模板表）
  const empty = await createTestStore();
  try {
    const cats = empty.db.all('SELECT DISTINCT category FROM templates ORDER BY category').map((r) => r.category);
    assert.deepEqual(cats, ['newtask'], '内置任务模板永远在场（#191 只 newtask）');
    assert.equal(empty.db.get("SELECT count(*) AS c FROM templates WHERE id LIKE 't_%'").c, 0);
  } finally {
    empty.reset();
  }
});

test('timegoals.json 导入：task: 作用域换算 task_id；队列级丢弃 + 报告；文件缺失 → goals 空', async () => {
  const fixture = readFixtureJson('legacy-json/localtasks.json');
  const s = await createTestStore({ open: false });
  s.seedLegacy({
    localtasks: fixture,
    timegoals: {
      version: 1,
      goals: {
        // legacy key（T03 前的 sha1 目录名）+ 任务号 → 换算成 tasks.id
        'task:legacyhash0000001:3': {
          key: 'task:legacyhash0000001:3',
          durationSec: 3600,
          prompt: '历史目标的提示词',
          startedAt: '2026-01-01 08:00:00',
          deadline: '2026-01-01 09:00:00',
          log: [
            { at: '2026-01-01 08:30:00', elapsedSec: 1800, remainingSec: 1800, overtimeSec: 0, reached: false, summary: '推进中', progress: '30%' },
          ],
        },
        // 队列级目标（键没有 task: 前缀）→ 既定裁决：丢弃 + 报告
        legacyhash0000001: { key: 'legacyhash0000001', durationSec: 60, prompt: '队列级', startedAt: '2026-01-01 08:00:00', deadline: '2026-01-01 08:01:00' },
      },
    },
  });
  s.open();
  try {
    const goal = s.db.get(
      `SELECT g.* FROM goals g JOIN tasks t ON t.id = g.task_id
       JOIN topics tp ON tp.id = t.repo_topic_id WHERE tp.ext LIKE '%legacyhash0000001%' AND t.seq = 3`
    );
    assert.ok(goal, 'task: 作用域换算到 tasks.id');
    assert.equal(goal.duration_sec, 3600);
    assert.equal(goal.prompt, '历史目标的提示词');
    const checks = s.db.all('SELECT * FROM goal_checks WHERE goal_id = :g ORDER BY id', { g: goal.id });
    assert.equal(checks.length, 1, '历史 check 流水随 goal 一起进库');
    assert.equal(checks[0].remaining_sec, 1800, '当日快照原样保留');

    const report = s.core.getBootstrapResult().report;
    assert.ok(
      report.discarded.some((d) => d.what === 'timegoal(queue-scope)'),
      '队列级目标按裁决丢弃并报告'
    );
  } finally {
    s.reset();
  }

  // 文件不存在：goals 表为空（本机真实环境就是这条路径）
  const empty = await createTestStore();
  try {
    assert.equal(empty.db.get('SELECT count(*) AS c FROM goals').c, 0);
    assert.equal(empty.db.get('SELECT count(*) AS c FROM goal_checks').c, 0);
  } finally {
    empty.reset();
  }
});

test('settings：localtask 5 项 + config 4 项偏好进库，token 等凭据绝不进库', async () => {  const s = await importFixture();
  try {
    const keys = s.db.all('SELECT key FROM settings ORDER BY key').map((r) => r.key);
    assert.deepEqual(keys, [
      'app.attachmentsDir',
      'app.autoSyncAttachments',
      'app.gitDevRoot',
      'app.gitRepoRoot',
      'lt.ackPrompt',
      'lt.attachTemplate',
      'lt.deliveryTemplate',
      'lt.taskSuffix',
      'lt.timeoutSec',
    ]);
    assert.equal(s.db.get('SELECT value FROM settings WHERE key = :k', { k: 'lt.timeoutSec' }).value, '240');
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM settings WHERE key LIKE '%token%' OR key LIKE '%baseUrl%' OR key LIKE '%email%'").c,
      0,
      '凭据绝不能进 settings（库会被备份、dump、拷走排障）'
    );
    const all = JSON.stringify(s.db.all('SELECT key, value FROM settings'));
    assert.doesNotMatch(all, /SECRET-TOKEN/);
  } finally {
    s.reset();
  }
});

test('真实形状夹具（17 队列 / 59 任务；#190 全局池那 1 队列 16 任务不迁移）：done=46 / claimed=5 / pending=8（D1 判据红线）', async () => {
  const store = await createTestStore({ open: false });
  try {
    const data = readFixtureJson('legacy-real-shape.json');
    store.seedLegacy({ localtasks: data });
    store.open();
    const dist = Object.fromEntries(
      store.db.all('SELECT status, count(*) AS c FROM tasks GROUP BY status').map((r) => [r.status, r.c])
    );
    // #190：夹具里 18 队列中含 1 个全局池队列（16 条任务，全是 done）——整行跳过不迁移
    assert.deepEqual(dist, { done: 46, claimed: 5, pending: 8 });
    assert.equal(store.db.get('SELECT count(*) AS c FROM tasks').c, 59);
    assert.equal(store.db.get('SELECT count(*) AS c FROM topics').c, 17);

    // 陷阱的机器可检形式：pending 里有的带 roundSummary 键（值空串）。
    // 判据一旦写成 `'roundSummary' in t` 或「非空 → done 全局优先」，这里立刻变红。
    let pendingWithEmptySummaryKey = 0;
    for (const t of Object.values(data.topics)) {
      for (const task of t.tasks) {
        if (task.status === 'pending' && task.roundSummary === '') pendingWithEmptySummaryKey += 1;
      }
    }
    assert.ok(pendingWithEmptySummaryKey > 0, '夹具必须保留"pending 带空串 roundSummary"这个坑');

    // 词表语义的机器可检形式
    assert.equal(
      store.db.get("SELECT count(*) AS c FROM tasks WHERE status = 'done' AND (done_at IS NULL OR feedback = '')").c,
      0
    );
    assert.equal(
      store.db.get("SELECT count(*) AS c FROM tasks WHERE status = 'claimed' AND claimed_at IS NULL").c,
      0
    );
  } finally {
    store.reset();
  }
});

// ════ db-migrate-from-json-assets.test.mjs（#200 合并入本文件）════
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
    // #190：夹具里 9 条任务中 1 条属于全局池（cwd 空），跳过不迁移
    assert.equal(out.result.report.imported.tasks, 8);
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
    assert.equal(s.db.get('SELECT count(*) AS c FROM tasks').c, 8, '最终只有一份数据（全局池那 1 条不迁移）');
    assert.equal(s.db.get('SELECT count(*) AS c FROM topics').c, 2, '全局池那条队列不迁移');
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
    // #190：全局池那 1 条（done）随队列跳过
    assert.equal(out.counts.tasks, 8);
    assert.deepEqual(out.distribution, { pending: 3, claimed: 1, done: 3, cancelled: 1 });
  } finally {
    s.reset();
  }
});

