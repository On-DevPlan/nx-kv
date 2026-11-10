// 全量导入（JSON → SQLite）· 附属资产与红线夹具：
// templates.json / timegoals.json / settings 的导入路径，以及真实形状夹具的分布红线。
//
// 回归红线：真实形状夹具的分布必须是 done=62 / claimed=5 / pending=8，
// 且 8 条 pending 全都带 `roundSummary: ""` —— 一旦谁把判据改成
// 「roundSummary 存在 → done」，这 8 条会立刻变成已完成，这里当场红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore, readFixtureJson } from '../support/test-store.mjs';
import { importFixture } from '../support/legacy-import.mjs';

// ─── T06：templates.json / timegoals.json 的导入路径（含「文件不存在」）────

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

  // 文件不存在：全新库 → 只有 bootstrap seed 的四个内置模板
  const empty = await createTestStore();
  try {
    const cats = empty.db.all('SELECT DISTINCT category FROM templates ORDER BY category').map((r) => r.category);
    assert.deepEqual(cats, ['context', 'delivery', 'enhance', 'newtask'], '内置永远在场');
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
       JOIN topics tp ON tp.id = t.topic_id WHERE tp.ext LIKE '%legacyhash0000001%' AND t.seq = 3`
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

test('真实形状夹具（18 队列 / 75 任务）：done=62 / claimed=5 / pending=8（D1 判据红线）', async () => {
  const store = await createTestStore({ open: false });
  try {
    const data = readFixtureJson('legacy-real-shape.json');
    store.seedLegacy({ localtasks: data });
    store.open();
    const dist = Object.fromEntries(
      store.db.all('SELECT status, count(*) AS c FROM tasks GROUP BY status').map((r) => [r.status, r.c])
    );
    assert.deepEqual(dist, { done: 62, claimed: 5, pending: 8 });
    assert.equal(store.db.get('SELECT count(*) AS c FROM tasks').c, 75);
    assert.equal(store.db.get('SELECT count(*) AS c FROM topics').c, 18);

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
