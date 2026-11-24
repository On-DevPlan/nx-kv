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
  sha256,
} from '../support/legacy-import.mjs';
test('5 步嵌套判据：pending / done / claimed / cancelled / 未知 各自落对（含空串 roundSummary 陷阱）', async () => {
  const s = await importFixture();
  try {
    const bySeq = new Map(
      s.db.all('SELECT seq, status, done_at, feedback, claimed_at FROM tasks WHERE repo_topic_id = (SELECT id FROM topics WHERE cwd = \'D:/work/web\')').map((r) => [r.seq, r])
    );
    assert.equal(bySeq.get(1).status, 'pending', 'pending + roundSummary:"" 必须仍是 pending');
    assert.equal(bySeq.get(2).status, 'done', 'consumed + 非空 roundSummary → done');
    assert.equal(bySeq.get(2).feedback, '做完了一件事');
    assert.ok(bySeq.get(2).done_at, 'done 行必须有 done_at（completedAt 为空时回落 updatedAt）');
    assert.equal(bySeq.get(3).status, 'claimed', 'consumed + 无 roundSummary → claimed');
    assert.equal(bySeq.get(3).done_at, null);
    assert.ok(bySeq.get(3).claimed_at, 'consumedAt → claimed_at');
    assert.equal(bySeq.get(4).status, 'done', 'archived + 有结论 → done');
    assert.equal(bySeq.get(5).status, 'cancelled', 'archived + 无结论 → cancelled');
    assert.equal(bySeq.get(6).status, 'pending', '未知状态 → pending');
    assert.equal(bySeq.get(7).status, 'pending');
    assert.equal(bySeq.get(8).status, 'done');

    const dist = Object.fromEntries(s.db.all('SELECT status, count(*) AS c FROM tasks GROUP BY status').map((r) => [r.status, r.c]));
    // #190：夹具里全局池那条 done 任务随队列一起跳过（不迁移），done 计 3
    assert.deepEqual(dist, { pending: 3, claimed: 1, done: 3, cancelled: 1 });
  } finally {
    s.reset();
  }
});

test('软删与状态正交：deletedAt 写进 deleted_at，状态照判据走', async () => {
  const s = await importFixture();
  try {
    const row = s.db.get("SELECT status, deleted_at FROM tasks WHERE seq = 7 AND repo_topic_id = (SELECT id FROM topics WHERE cwd = 'D:/work/web')");
    assert.equal(row.status, 'pending');
    assert.ok(row.deleted_at, 'deletedAt 必须落到 deleted_at');
  } finally {
    s.reset();
  }
});

test('tasks.seq 保持原 id；body 逐条哈希一致；时间按本地时区解析', async () => {
  const s = await importFixture();
  try {
    const legacy = readFixtureJson('legacy-json/localtasks.json');
    const topicIdByLegacyKey = new Map();
    for (const t of s.db.all('SELECT id, ext FROM topics')) {
      topicIdByLegacyKey.set(JSON.parse(t.ext).ext_legacy_key, t.id);
    }
    for (const [legacyKey, lt] of Object.entries(legacy.topics)) {
      const topicId = topicIdByLegacyKey.get(legacyKey);
      // #190：全局池 / 空 cwd 的队列按设计不迁移，跳过（不算失败）
      const cwd = String((lt && (lt.cwd || (Array.isArray(lt.cwds) && lt.cwds[0]))) || '').trim();
      if (!cwd) {
        assert.equal(topicId, undefined, `全局池队列 ${legacyKey} 不该迁移`);
        continue;
      }
      assert.ok(topicId, `队列 ${legacyKey} 未迁移`);
      for (const task of lt.tasks) {
        const row = s.db.get('SELECT seq, body, created_at FROM tasks WHERE repo_topic_id = :t AND seq = :s', {
          t: topicId,
          s: task.id,
        });
        assert.ok(row, `任务 ${legacyKey}:${task.id} 未迁移`);
        assert.equal(row.seq, task.id, 'seq 必须等于原 id（对外编号不能漂）');
        assert.equal(sha256(row.body), sha256(task.text));
        // "YYYY-MM-DD HH:mm:ss" 是**本地**时间：用本地构造，不能 Date.parse
        const [y, mo, d, h, mi, se] = task.createdAt.match(/\d+/g).map(Number);
        assert.equal(row.created_at, new Date(y, mo - 1, d, h, mi, se).getTime());
      }
    }
  } finally {
    s.reset();
  }
});

test('正文超长按 MAX_BODY 截断 + ext_body_truncated 标记（不整体失败）', async () => {
  const s = await createTestStore({ open: false });
  try {
    const data = readFixtureJson('legacy-json/localtasks.json');
    data.topics.legacyhash0000002.tasks = [
      { id: 1, text: 'x'.repeat(20_050), status: 'pending', createdAt: '2026-10-04 08:01:00' },
    ];
    s.seedLegacy({ localtasks: data });
    s.open();
    const row = s.db.get("SELECT body, ext FROM tasks WHERE seq = 1 AND repo_topic_id = (SELECT id FROM topics WHERE cwd = 'D:/work/api')");
    assert.equal(row.body.length, 20_000);
    assert.equal(JSON.parse(row.ext).ext_body_truncated, 1);
  } finally {
    s.reset();
  }
});

// ════ db-migrate-from-json-status.test.mjs（#200 合并入本文件）════
test('ext 取证：archived / legacy_key / pickupSec / history / supersededBy 都在 ext 里', async () => {
  const s = await importFixture();
  try {
    const topic = s.db.get("SELECT id, ext FROM topics WHERE cwd = 'D:/work/web'");
    const tExt = JSON.parse(topic.ext);
    assert.equal(tExt.ext_legacy_key, 'legacyhash0000001', '旧 key 只写进 ext（不参与任何查询）');
    assert.equal(tExt.ext_last_summary, '队列现状摘要');
    assert.equal(tExt.ext_manual, 1);

    const archived = s.db.get(`SELECT ext FROM tasks WHERE seq = 4 AND repo_topic_id = ${topic.id}`);
    assert.equal(JSON.parse(archived.ext).ext_archived, 1, 'archived 要留 ext_archived 标记');

    const rich = s.db.get(`SELECT ext, round, from_src, blocks_following FROM tasks WHERE seq = 8 AND repo_topic_id = ${topic.id}`);
    const rExt = JSON.parse(rich.ext);
    assert.equal(rExt.ext_pickup_sec, 42);
    assert.equal(rExt.ext_trash_index, undefined);
    assert.equal(rExt.ext_superseded_by, 9);
    assert.ok(Array.isArray(rExt.ext_legacy_history), 'history 整体丢弃但要在 ext 留证');
    // 迁出墓碑必须保留（否则搬去云端、本机还挂 pending 的那条会被当成待领取复活）
    assert.equal(rExt.ext_migrated_to.side, 'cloud');
    assert.equal(rExt.ext_migrated_to.topic, 'elsewhere');
    assert.equal(rich.round, 3, 'round = reopenCount + 1');
    assert.equal(rich.blocks_following, 1);
  } finally {
    s.reset();
  }
});

test('topics：key 由 (cwd, group) 派生、全局池行整行跳过、队列绑真实仓库（#197 无哨兵）', async () => {
  const s = await importFixture();
  try {
    const { topicKeyOf } = s.core;
    const topics = s.db.all('SELECT id, key, cwd, group_key, repo_key, next_seq FROM topics');
    // #190：夹具里 3 条 legacy 队列（web / api / 全局池）——全局池那条整行跳过
    assert.equal(topics.length, 2);
    for (const t of topics) {
      assert.equal(t.key, topicKeyOf(t.cwd, t.group_key || ''), 'key 必须是派生值');
      // #197：队列必须绑真实仓库（按 cwd 匹配登记的仓库），不再有 __unbound__
      assert.notEqual(t.repo_key, '__unbound__', '不允许哨兵仓库');
    }
    assert.equal(topics.find((t) => t.cwd === 'D:/work/web').repo_key, 'github.com/acme/web', 'cwd 匹配到 web 仓库');
    assert.equal(topics.find((t) => t.cwd === 'D:/work/api').repo_key, 'github.com/acme/api', 'cwd 匹配到 api 仓库');
    // #190：全局池（cwd 为空）不再迁移进来
    assert.equal(topics.find((t) => t.cwd === ''), undefined, '全局池行不迁移');
    assert.equal(s.db.get("SELECT count(*) AS c FROM topics WHERE key = '__GLOBAL__'").c, 0);

    // next_seq = max(seq)+1
    const web = topics.find((t) => t.cwd === 'D:/work/web');
    assert.equal(web.next_seq, 9, '8 条任务 → next_seq 9');
    const api = topics.find((t) => t.cwd === 'D:/work/api');
    assert.equal(api.next_seq, 1, '空队列 next_seq 从 1 起');
  } finally {
    s.reset();
  }
});

test('repos：2 repo + 1 组（#197 无哨兵）；组 key 冻结为 group/<slug>；旧 id 进 ext', async () => {
  const s = await importFixture();
  try {
    const repos = s.db.all('SELECT key, type, name, ext, created_at FROM repos ORDER BY key');
    assert.deepEqual(
      repos.map((r) => r.key),
      ['github.com/acme/api', 'github.com/acme/web', 'group/前端组']
    );
    const group = repos.find((r) => r.type === 'group');
    assert.equal(group.name, '前端组');
    assert.equal(JSON.parse(group.ext).ext_legacy_id, 'b_fixture_group');

    const web = repos.find((r) => r.key === 'github.com/acme/web');
    const ext = JSON.parse(web.ext);
    assert.equal(ext.ext_legacy_id, 'r_fixture_web');
    assert.equal(ext.ext_legacy_type, 'dev', 'legacy type(ref/dev) 不是新 schema 的二分，存 ext');
    assert.equal(ext.ext_notes, '随手记的备注');
    assert.equal(ext.ext_icon, '🌐');
    assert.deepEqual(ext.ext_remotes, ['git@github.com:Acme/Web.git', 'https://github.com/Acme/Web.git']);
    // ISO（UTC）→ epoch ms
    assert.equal(web.created_at, Date.parse('2026-09-01T02:00:00.000Z'));

    // 成员边：ghost 不存在 → 报告丢弃，边只有 2 条
    // v13：repo_group_members.note 已 DROP（主体是成员关系本身，无显示位），
    // 只校验组成员 key 集合 / 条数 / 顺序，不再 SELECT 或断言 note 列。
    const members = s.db.all('SELECT group_key, repo_key, position FROM repo_group_members ORDER BY position');
    assert.equal(members.length, 2);
    assert.deepEqual(
      members.map((m) => m.repo_key),
      ['github.com/acme/web', 'github.com/acme/api']
    );
    assert.ok(members.every((m) => m.group_key === 'group/前端组'));
    assert.equal(members[1].position, 1);
  } finally {
    s.reset();
  }
});

test('links / deps / goals：forkOf → task_links，blockBy → task_deps，内嵌 timegoal → goals+goal_checks', async () => {
  const s = await importFixture();
  try {
    const link = s.db.get('SELECT src_id, dst_id, type FROM task_links');
    assert.ok(link, 'forkOf 应迁成一条 task_links');
    assert.equal(link.type, 'reopen', 'forkKind 映射');
    const srcSeq = s.db.get('SELECT seq FROM tasks WHERE id = :id', { id: link.src_id }).seq;
    const dstSeq = s.db.get('SELECT seq FROM tasks WHERE id = :id', { id: link.dst_id }).seq;
    assert.deepEqual([srcSeq, dstSeq], [8, 2], '方向恒为 新 → 旧');

    const dep = s.db.get('SELECT task_id, dep_id FROM task_deps');
    assert.ok(dep);
    assert.equal(s.db.get('SELECT seq FROM tasks WHERE id = :id', { id: dep.dep_id }).seq, 3);

    const goal = s.db.get('SELECT duration_sec, prompt, deadline, started_at FROM goals');
    assert.equal(goal.duration_sec, 1800);
    assert.equal(goal.prompt, '半小时内交');
    assert.equal(goal.deadline - goal.started_at, 1800 * 1000);
    const checks = s.db.all('SELECT elapsed_sec, remaining_sec, overtime_sec, reached FROM goal_checks ORDER BY at');
    assert.equal(checks.length, 2);
    assert.equal(checks[1].reached, 1);
    assert.equal(checks[1].overtime_sec, 120);
  } finally {
    s.reset();
  }
});

test('refs / ref_bindings：约定路径绑定宿主，未绑定的留 orphan；v2 关系表为空', async () => {
  const s = await importFixture();
  try {
    const refs = s.db.all('SELECT locator, state FROM refs ORDER BY locator');
    const locators = refs.map((r) => r.locator);
    assert.deepEqual(locators, [
      'board/前端组.md',
      'free/orphan.md',
      'group/前端组/github.com/acme/web.md',
      'repo/github.com/acme/api.md',
      'repo/github.com/acme/web/index.md',
    ].sort());
    assert.equal(refs.find((r) => r.locator === 'free/orphan.md').state, 'orphan');

    const bindings = s.db.all('SELECT repo_key, group_key, type FROM ref_bindings ORDER BY type, repo_key');
    assert.equal(bindings.length, 4);
    assert.deepEqual(
      bindings.map((b) => `${b.type}:${b.repo_key}${b.group_key ? '#' + b.group_key : ''}`).sort(),
      ['group:group/前端组', 'group_repo:github.com/acme/web#group/前端组', 'repo:github.com/acme/api', 'repo:github.com/acme/web']
    );
    // v2：ref_relations 已删除；文档↔资源关系改由 ref_attach 承担
    assert.equal(s.db.get('SELECT count(*) AS c FROM ref_attach').c, 0);
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='ref_relations'").c,
      0,
      'ref_relations 在 v2 必须删除'
    );
  } finally {
    s.reset();
  }
});

