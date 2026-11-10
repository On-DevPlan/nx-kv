// 全量导入（JSON → SQLite）· 结构映射：
// ext 取证、topics 派生 key 与哨兵仓库、repos/组与成员边、links/deps/goals、refs/ref_bindings。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFixture } from '../support/legacy-import.mjs';

test('ext 取证：archived / legacy_key / pickupSec / history / supersededBy 都在 ext 里', async () => {
  const s = await importFixture();
  try {
    const topic = s.db.get("SELECT id, ext FROM topics WHERE cwd = 'D:/work/web'");
    const tExt = JSON.parse(topic.ext);
    assert.equal(tExt.ext_legacy_key, 'legacyhash0000001', '旧 key 只写进 ext（不参与任何查询）');
    assert.equal(tExt.ext_last_summary, '队列现状摘要');
    assert.equal(tExt.ext_manual, 1);

    const archived = s.db.get(`SELECT ext FROM tasks WHERE seq = 4 AND topic_id = ${topic.id}`);
    assert.equal(JSON.parse(archived.ext).ext_archived, 1, 'archived 要留 ext_archived 标记');

    const rich = s.db.get(`SELECT ext, round, from_src, blocks_following FROM tasks WHERE seq = 8 AND topic_id = ${topic.id}`);
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

test('topics：key 由 (cwd, group) 派生、全局池 cwd="" key="__GLOBAL__"、队列全挂哨兵仓库', async () => {
  const s = await importFixture();
  try {
    const { topicKeyOf } = s.core;
    const topics = s.db.all('SELECT id, key, cwd, group_key, repo_key, next_seq FROM topics');
    assert.equal(topics.length, 3);
    for (const t of topics) {
      assert.equal(t.key, topicKeyOf(t.cwd, t.group_key || ''), 'key 必须是派生值');
      assert.equal(t.repo_key, '__unbound__');
    }
    const global = topics.find((t) => t.cwd === '');
    assert.equal(global.key, '__GLOBAL__');
    assert.equal(JSON.parse(s.db.get(`SELECT ext FROM topics WHERE id = ${global.id}`).ext).ext_global, 1);

    // next_seq = max(seq)+1
    const web = topics.find((t) => t.cwd === 'D:/work/web');
    assert.equal(web.next_seq, 9, '8 条任务 → next_seq 9');
    const api = topics.find((t) => t.cwd === 'D:/work/api');
    assert.equal(api.next_seq, 1, '空队列 next_seq 从 1 起');
  } finally {
    s.reset();
  }
});

test('repos：2 repo + 1 组 + 哨兵；组 key 冻结为 group/<slug>；旧 id 进 ext', async () => {
  const s = await importFixture();
  try {
    const repos = s.db.all('SELECT key, type, name, ext, created_at FROM repos ORDER BY key');
    assert.deepEqual(
      repos.map((r) => r.key),
      ['__unbound__', 'github.com/acme/api', 'github.com/acme/web', 'group/前端组']
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
    const members = s.db.all('SELECT group_key, repo_key, position, note FROM repo_group_members ORDER BY position');
    assert.equal(members.length, 2);
    assert.equal(members[0].repo_key, 'github.com/acme/web');
    assert.equal(members[0].note, '主站', 'repoNotes → repo_group_members.note');
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
