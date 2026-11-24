// schema v16 → v17 的数据迁移（与 v17.sql 同一事务执行）：#197 第二步
//
// v16 把组任务拆到了 (cwd, group_key) 队列；v17 改成「仓库队列 + 组队列」两条关联：
//   1. 组队列（group_key 非空）里的任务搬回同 cwd 的仓库队列（seq 冲突则顺延重编号）；
//      同时把组队列 topic 换成 'group:<组key>' 形态的**组 topic**，任务挂上 group_topic_id。
//   2. 旧组队列行删除（它的任务与编号都已转移）。
//   3. tasks.repo_key 列在 v17.sql 里已被丢弃——仓库归属统一由 repo_topic 表达。
//
// 编号不丢：搬回仓库队列时尽量保留原 seq，占用了才顺延（与历史搬家同一口径）。
import { topicKeyOf } from '../../topic-key.js';

export interface V17Context {
  atMs?: number;
}

export interface V17Result {
  movedBack: number;
  groupTopics: number;
  droppedTopics: number;
}

export function normalizeTopicLinks(
  conn: any,
  { atMs = Date.now() }: V17Context = {},
): V17Result {
  const result: V17Result = { movedBack: 0, groupTopics: 0, droppedTopics: 0 };

  /** 找/建仓库队列 topic（cwd + 真实 repo，group_key 为空）。 */
  const ensureRepoTopic = (cwd: string, repoKey: string, name: string): number => {
    const key = repoKeyOfCwd(cwd);
    const hit = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    if (hit) return Number(hit.id);
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, :repo, :cwd, NULL, :name, 1, '{}', '', 0, NULL, :at, :at)`,
      { key, repo: repoKey, cwd, name: name || String(cwd).split(/[\\/]/).pop() || key, at: atMs },
    );
    const created = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    return Number(created.id);
  };

  /** 找/建组 topic（key = 'group:<组key>'，cwd 空，repo_key 指向组行）。 */
  const ensureGroupTopic = (groupKey: string): number => {
    const key = `group:${groupKey}`;
    const hit = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    if (hit) return Number(hit.id);
    const g = conn.get('SELECT name FROM repos WHERE key = :k', { k: groupKey });
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, :repo, '', :group, :name, 1, '{}', '', 0, NULL, :at, :at)`,
      { key, repo: groupKey, group: groupKey, name: String((g && g.name) || groupKey), at: atMs },
    );
    result.groupTopics += 1;
    const created = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    return Number(created.id);
  };

  // 组队列 = v16 拆出来的 (cwd, group_key) topic
  const groupTopics = conn.all(
    'SELECT id, cwd, name, repo_key, group_key FROM topics WHERE group_key IS NOT NULL',
  );
  for (const t of groupTopics) {
    const oldTid = Number(t.id);
    const cwd = String(t.cwd || '');
    const groupKey = String(t.group_key || '');
    const repoKey = String(t.repo_key || '');
    const repoTid = ensureRepoTopic(cwd, repoKey, String(t.name || ''));
    const gtid = ensureGroupTopic(groupKey);

    // 搬任务（保 seq，冲突顺延）
    const tasks = conn.all('SELECT id, seq FROM tasks WHERE repo_topic_id = :t', { t: oldTid });
    for (const task of tasks) {
      let seq = Number(task.seq) || 1;
      // 同队列同号被占（且不是自己）→ 顺延
      while (
        conn.get('SELECT 1 AS ok FROM tasks WHERE repo_topic_id = :t AND seq = :s AND id <> :id', {
          t: repoTid, s: seq, id: Number(task.id),
        })
      ) {
        seq += 1;
      }
      conn.run('UPDATE tasks SET repo_topic_id = :rt, group_topic_id = :gt, seq = :s WHERE id = :id', {
        rt: repoTid, gt: gtid, s: seq, id: Number(task.id),
      });
      result.movedBack += 1;
    }
    // 目标队列的 next_seq 顶到最大号之后
    conn.run(
      `UPDATE topics SET next_seq = MAX(next_seq, COALESCE((
         SELECT MAX(seq) FROM tasks WHERE repo_topic_id = :t), 0) + 1) WHERE id = :id`,
      { t: repoTid, id: repoTid },
    );
    // 旧组队列行删除（任务已全部转走）
    conn.run('DELETE FROM topics WHERE id = :id', { id: oldTid });
    result.droppedTopics += 1;
  }

  return result;
}

/** 仓库队列 key：与 topicKeyOf(cwd, '') 完全同一派生（core 纯函数，直接复用）。 */
function repoKeyOfCwd(cwd: string): string {
  return topicKeyOf(String(cwd ?? ''), '');
}

export function migrateTopicLinks(conn: any, ctx: V17Context = {}): V17Result {
  return normalizeTopicLinks(conn, ctx);
}
