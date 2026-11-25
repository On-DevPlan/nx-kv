// v18 迁移：恢复「带待领任务的软删队列」（幽灵队列修复）。
//
// 场景：历史版本的 prune 曾软删带任务的队列（tasks 保留），任务后来变回
// pending——任何 cwd 都领不到。v18 把这类队列恢复（deleted_at = NULL）；
// 只挂 done/cancelled 的软删队列**不动**（已完成任务挂死队列只是历史记录）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';
import { migrate } from '../../src/core/db/migrator.js';
import { buildV1Sample } from '../fixtures/db-samples.mjs';

const AT = Date.UTC(2026, 10, 24, 12, 0, 0);

/** 把库升到 v17 并造「软删队列 + 任务」的存量样本。 */
async function seedV17() {
  const s = await createTestStore({ open: false, importLegacy: false });
  buildV1Sample(s); // 先建 v1 schema（含 settings 等表）
  const db = s.core.openRaw(s.dbPath);
  migrate(db, {
    from: 1, to: 17,
    context: { attachmentsRoot: join(s.appDir, 'attachments'), docsDir: join(s.appDir, 'docs'), atMs: AT },
  });
  assert.equal(db.get('PRAGMA user_version').user_version, 17, '前置：库停在 v17');

  // 三条目录队列：A 挂 pending（应恢复）、B 只挂 done（不动）、C 空（不动）
  const repos = [
    { key: 'local/ghost-a', path: 'D:/tmp/ghost-a' },
    { key: 'local/ghost-b', path: 'D:/tmp/ghost-b' },
    { key: 'local/ghost-c', path: 'D:/tmp/ghost-c' },
  ];
  for (const r of repos) {
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, 'repo', :name, '', :path, '', 0, '{}', '', 0, NULL, :at, :at)`,
      { key: r.key, name: r.key.slice('local/'.length), path: r.path, at: AT }
    );
    db.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                            deleted_at, created_at, updated_at)
       VALUES (:k, :rk, :cwd, NULL, :name, 1, '{}', '', 0, NULL, :at, :at)`,
      { k: require_key(r.path), rk: r.key, cwd: r.path, name: r.key, at: AT }
    );
  }
  // topicKey 派生与 topicKeyOf 同口径（sha1('|' + cwd小写) 前 16 位）——直接从已建行反查
  const rows = db.all('SELECT id, key, repo_key FROM topics WHERE repo_key LIKE \'local/ghost%\'');
  const byRepo = new Map(rows.map((r) => [r.repo_key, r]));
  const insTask = (topicKey, repoKey, seq, status) => {
    const t = byRepo.get(repoKey);
    db.run(
      `INSERT INTO tasks (repo_topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                           from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                           created_at, updated_at)
       VALUES (:t, :s, '', :st, 0, '# 任务', '{}', '', NULL, '', 0, NULL, NULL, 1, NULL, :at, :at)`,
      { t: t.id, s: seq, st: status, at: AT }
    );
  };
  insTask(byRepo.get('local/ghost-a').key, 'local/ghost-a', 1, 'pending');
  insTask(byRepo.get('local/ghost-b').key, 'local/ghost-b', 1, 'done');
  // 软删三条队列（模拟历史 prune）
  db.run(`UPDATE topics SET deleted_at = :at WHERE repo_key LIKE 'local/ghost%'`, { at: AT });
  return { s, db };
}

// topicKey 派生（与 core/topic-key.ts 同口径的最小复制）
import { createHash } from 'node:crypto';
import { join } from 'node:path';
function require_key(cwd) {
  return createHash('sha1').update('|' + String(cwd).toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}

test('v18：挂 pending 任务的软删队列恢复，只挂 done 的不动', async () => {
  const { s, db } = await seedV17();
  try {
    migrate(db, { from: 17, to: 18, context: { atMs: AT } });
    assert.equal(db.get('PRAGMA user_version').user_version, 18);

    const state = Object.fromEntries(
      db.all(`SELECT repo_key, deleted_at FROM topics WHERE repo_key LIKE 'local/ghost%'`)
        .map((r) => [r.repo_key, r.deleted_at])
    );
    assert.equal(state['local/ghost-a'], null, '挂 pending 的队列已恢复（deleted_at 清空）');
    assert.ok(state['local/ghost-b'] != null, '只挂 done 的队列保持软删');
    assert.ok(state['local/ghost-c'] != null, '空队列保持软删');

    // 恢复后的队列在目录列表里可见、任务可寻址
    const visible = db.all(`SELECT key, cwd FROM topics WHERE deleted_at IS NULL AND cwd <> ''`);
    assert.ok(visible.some((r) => r.cwd === 'D:/tmp/ghost-a'), '恢复后的队列回到目录列表');
  } finally {
    s.core.closeDb();
  }
});

test('v18：组队列（cwd 空）不因挂了任务而恢复', async () => {
  const { s, db } = await seedV17();
  try {
    // 造一个软删组队列 + 一条挂它上面的 pending 任务（不应恢复——组任务寻址走 group 关联）
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES ('board/x', 'group', 'x', '', '', '', 0, '{}', '', 0, NULL, :at, :at)`,
      { at: AT }
    );
    db.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                            deleted_at, created_at, updated_at)
       VALUES ('group/board/x', 'board/x', '', 'board/x', 'x', 1, '{}', '', 0, :at, :at, :at)`,
      { at: AT }
    );
    const gid = db.get(`SELECT id FROM topics WHERE key = 'group/board/x'`).id;
    db.run(
      `INSERT INTO tasks (repo_topic_id, group_topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                           from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                           created_at, updated_at)
       VALUES (:t, :g, 1, '', 'pending', 0, '# 组任务', '{}', '', NULL, '', 0, NULL, NULL, 1, NULL, :at, :at)`,
      { t: gid, g: gid, at: AT }
    );
    db.run(`UPDATE topics SET deleted_at = :at WHERE key = 'group/board/x'`, { at: AT });

    migrate(db, { from: 17, to: 18, context: { atMs: AT } });
    const del = db.get(`SELECT deleted_at FROM topics WHERE key = 'group/board/x'`).deleted_at;
    assert.ok(del != null, '组队列保持软删（组任务走 group_topic_id 关联寻址，不走目录队列）');
  } finally {
    s.core.closeDb();
  }
});
