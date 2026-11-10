// 全量导入（JSON → SQLite）· 状态与任务映射：
// 5 步嵌套判据、软删正交、seq/正文哈希逐条对账、超长截断。
//
// 回归红线：判据一旦写成「roundSummary 存在 → done」，
// pending 带空串 roundSummary 的任务会立刻变已完成，这里当场红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore, readFixtureJson } from '../support/test-store.mjs';
import { importFixture, sha256 } from '../support/legacy-import.mjs';

test('5 步嵌套判据：pending / done / claimed / cancelled / 未知 各自落对（含空串 roundSummary 陷阱）', async () => {
  const s = await importFixture();
  try {
    const bySeq = new Map(
      s.db.all('SELECT seq, status, done_at, feedback, claimed_at FROM tasks WHERE topic_id = (SELECT id FROM topics WHERE cwd = \'D:/work/web\')').map((r) => [r.seq, r])
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
    assert.deepEqual(dist, { pending: 3, claimed: 1, done: 4, cancelled: 1 });
  } finally {
    s.reset();
  }
});

test('软删与状态正交：deletedAt 写进 deleted_at，状态照判据走', async () => {
  const s = await importFixture();
  try {
    const row = s.db.get("SELECT status, deleted_at FROM tasks WHERE seq = 7 AND topic_id = (SELECT id FROM topics WHERE cwd = 'D:/work/web')");
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
      assert.ok(topicId, `队列 ${legacyKey} 未迁移`);
      for (const task of lt.tasks) {
        const row = s.db.get('SELECT seq, body, created_at FROM tasks WHERE topic_id = :t AND seq = :s', {
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
    const row = s.db.get("SELECT body, ext FROM tasks WHERE seq = 1 AND topic_id = (SELECT id FROM topics WHERE cwd = 'D:/work/api')");
    assert.equal(row.body.length, 20_000);
    assert.equal(JSON.parse(row.ext).ext_body_truncated, 1);
  } finally {
    s.reset();
  }
});
