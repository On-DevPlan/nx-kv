// #126 · plan 临时草稿态：迁移 + 契约 + 「不进队列」。
//
// 覆盖三件事：
//   ① v8 → v9 重建 tasks 后，行数据与四张关系表一行不丢，且 CHECK 里真的有 plan；
//   ② pending ↔ plan 双向切换，其它状态不许直接转；
//   ③ plan 任务不出现在 get / wait 的领取路径里（正判定 status='pending' 天然排除）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';
import { migrate } from '../../src/core/db/migrator.js';

/** 建一份 v8 形态的最小库（只含 v9.sql 会碰到的表）。 */
async function v8Store() {
  const s = await createTestStore({ open: false, bootstrap: false });
  const raw = s.open();
  raw.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE topics (id INTEGER PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL DEFAULT '');
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','done','cancelled')),
      version INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      ext TEXT NOT NULL DEFAULT '{}',
      feedback TEXT NOT NULL DEFAULT '',
      feedback_at INTEGER,
      from_src TEXT NOT NULL DEFAULT '',
      blocks_following INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER,
      done_at INTEGER,
      round INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (topic_id, seq)
    );
    CREATE TABLE task_links (src_id INTEGER, dst_id INTEGER, type TEXT, note TEXT, created_at INTEGER);
    CREATE TABLE task_deps (task_id INTEGER, dep_id INTEGER, created_at INTEGER);
    CREATE TABLE goals (id INTEGER PRIMARY KEY, task_id INTEGER, duration_sec INTEGER,
      started_at INTEGER, deadline INTEGER, prompt TEXT, state TEXT, version INTEGER,
      deleted_at INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE task_attach (task_id INTEGER, attachment_id TEXT, role TEXT,
      position INTEGER, note TEXT, created_at INTEGER);
    CREATE INDEX ix_tasks_pending ON tasks (topic_id, seq) WHERE status = 'pending' AND deleted_at IS NULL;
    CREATE INDEX ix_tasks_open ON tasks (status) WHERE deleted_at IS NULL;
    PRAGMA user_version = 8;
  `);
  const at = Date.now();
  raw.run("INSERT INTO topics (id, key, name) VALUES (1, 'dir/a', 'a')");
  for (const [seq, status] of [[1, 'pending'], [2, 'done'], [3, 'claimed']]) {
    raw.run(
      `INSERT INTO tasks (topic_id, seq, status, body, created_at, updated_at)
       VALUES (1, :seq, :status, '正文', :at, :at)`,
      { seq, status, at },
    );
  }
  raw.run("INSERT INTO task_links (src_id, dst_id, type, note, created_at) VALUES (1, 2, 'reopen', '链', :at)", { at });
  raw.run("INSERT INTO task_deps (task_id, dep_id, created_at) VALUES (3, 1, :at)", { at });
  raw.run(
    `INSERT INTO goals (id, task_id, duration_sec, started_at, deadline, prompt, state, version, deleted_at, created_at, updated_at)
     VALUES (1, 1, 3600, :at, :at2, '先写测试', '', 0, NULL, :at, :at)`,
    { at, at2: at + 3600000 },
  );
  raw.run("INSERT INTO task_attach (task_id, attachment_id, role, position, note, created_at) VALUES (1, 'att_1', 'inline', 0, '', :at)", { at });
  return { s, raw };
}

test('#126 v8→v9：重建 tasks 后数据与关系表一行不丢，CHECK 含 plan', async () => {
  const { s, raw } = await v8Store();
  try {
    const applied = migrate(raw, { from: 8, to: 9 });
    assert.deepEqual(applied, [9]);
    assert.equal(raw.get('PRAGMA user_version').user_version, 9);

    const rows = raw.all('SELECT seq, status, body FROM tasks ORDER BY seq');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.status), ['pending', 'done', 'claimed']);
    assert.ok(rows.every((r) => r.body === '正文'));
    assert.equal(raw.get('SELECT count(*) c FROM task_links').c, 1);
    assert.equal(raw.get('SELECT count(*) c FROM task_deps').c, 1);
    assert.equal(raw.get('SELECT count(*) c FROM goals').c, 1);
    assert.equal(raw.get('SELECT count(*) c FROM task_attach').c, 1);

    // plan 现在是可写入的合法状态
    raw.run("UPDATE tasks SET status = 'plan' WHERE seq = 1");
    assert.equal(raw.get("SELECT status FROM tasks WHERE seq = 1").status, 'plan');
    assert.throws(() => raw.run("UPDATE tasks SET status = 'weird' WHERE seq = 1"), /CHECK|constraint/i);
  } finally {
    s.reset();
  }
});

test('#126 plan 不进队列：get 领不到，pending 转回后又能领', async () => {
  const s = await createTestStore();
  const oldDb = process.env.NX_KV_DB;
  const oldHome = process.env.NX_KV_HOME;
  process.env.NX_KV_DB = s.dbPath;
  process.env.NX_KV_HOME = s.appDir;
  try {
    const svc = await import('../../src/modules/localtask/service.js');
    const cwd = s.dir;

    const added = await svc.addTask({ cwd, text: '# 草稿\n\n一个还没想清楚的点子' });
    const before = await svc.getTask({ cwd, id: added.task.id });
    assert.equal(before.status, 'pending');

    const toPlan = await svc.setPlanStatus({ cwd, id: added.task.id, to: 'plan' });
    assert.equal(toPlan.changed, true);
    assert.equal(toPlan.to, 'plan');
    const planned = await svc.getTask({ cwd, id: added.task.id });
    assert.equal(planned.status, 'plan', '视图里这条任务已经是草稿');

    // 队列里没有 pending → 领活返回 timeout（plan 不被领走）
    const { getTask } = await import('../../src/modules/tasktool/get.js');
    const r = await getTask({ cwd, open: false, instant: true });
    assert.equal(r.status, 'timeout', '草稿绝不能进入 get/wait 的队列');

    const repeat = await svc.setPlanStatus({ cwd, id: added.task.id, to: 'plan' });
    assert.equal(repeat.changed, false, '重复切换是幂等的');
    const back = await svc.setPlanStatus({ cwd, id: added.task.id, to: 'pending' });
    assert.equal(back.changed, true);
    const r2 = await getTask({ cwd, open: false, instant: true });
    assert.equal(Number(r2.task?.id), Number(added.task.id), '转回 pending 后重新可领');
  } finally {
    if (oldDb === undefined) delete process.env.NX_KV_DB; else process.env.NX_KV_DB = oldDb;
    if (oldHome === undefined) delete process.env.NX_KV_HOME; else process.env.NX_KV_HOME = oldHome;
    s.reset();
  }
});
