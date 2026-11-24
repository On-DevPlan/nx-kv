// schema v15 → v16 的数据迁移（与 v16.sql 同一事务执行）：#197 第一步
//
// 把正文 frontmatter 的归属搬进库内列：
//   1. 哨兵队列重绑：repo_key='__unbound__' 的 topic 按 cwd 匹配已登记仓库；
//      匹配不到就自动登记 local/<目录名>——绝不因为「找不到归属」丢任务。
//   2. frontmatter → 列：project → tasks.repo_key；board → 拆 (cwd, group_key) 组队列；
//      然后剥掉正文 --- 头。
//   3. 补齐 repo_key、删除哨兵仓库行。
//
// 本步骤已在 2026-11-24 应用到本机库（user_version=16），**逻辑不可再改**；
// 更彻底的归属规范（repo_topic_id / group_topic_id 两条关联）在 v17 做。
import { matchRepoKey, autoRepoKey } from '../repo-match.js';
import { topicKeyOf } from '../../topic-key.js';

// core 是最底层，不能反向 import shared —— 这里保留一份最小的 frontmatter 读/剥实现。
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FM_KV_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
function parseFrontmatter(src: unknown): Record<string, string> {
  const m = String(src ?? '').match(FM_RE);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = line.match(FM_KV_RE);
    if (kv) out[kv[1] ?? ''] = (kv[2] ?? '').trim();
  }
  return out;
}
function stripFrontmatter(src: unknown): string {
  return String(src ?? '').replace(FM_RE, (block: string, inner: string) => {
    const kv = String(inner || '').split(/\r?\n/).some((l) => FM_KV_RE.test(l));
    return kv ? '' : block;
  });
}

export interface V16Context {
  atMs?: number;
}

export interface V16Result {
  rebound: number;
  autoRepo: number;
  droppedTopic: number;
  stripped: number;
  moved: number;
  sentinelRemoved: number;
}

export function normalizeAssignments(
  conn: any,
  { atMs = Date.now() }: V16Context = {},
): V16Result {
  const result: V16Result = { rebound: 0, autoRepo: 0, droppedTopic: 0, stripped: 0, moved: 0, sentinelRemoved: 0 };

  // ── 1. 哨兵队列重绑 ──
  const realRepos: Array<{ key: string; path: string }> = conn
    .all("SELECT key, path FROM repos WHERE type = 'repo' AND path <> '' AND key <> '__unbound__'")
    .map((r: any) => ({ key: String(r.key), path: String(r.path) }));
  const takenKeys = new Set<string>(conn.all('SELECT key FROM repos').map((r: any) => String(r.key)));
  const sentinels = conn.all("SELECT id, key, cwd, name FROM topics WHERE repo_key = '__unbound__'");
  for (const t of sentinels) {
    const tid = Number(t.id);
    const cwd = String(t.cwd || '');
    const matched = matchRepoKey(cwd, realRepos);
    if (matched) {
      conn.run('UPDATE topics SET repo_key = :rk, updated_at = :at WHERE id = :id', { rk: matched, at: atMs, id: tid });
      result.rebound += 1;
      continue;
    }
    if (!cwd) {
      conn.run('DELETE FROM topics WHERE id = :id', { id: tid });
      result.droppedTopic += 1;
      continue;
    }
    const key = autoRepoKey(cwd, takenKeys);
    takenKeys.add(key);
    conn.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:key, 'repo', :name, '', :path, '', 0, '{}', '', 0, NULL, :at, :at)`,
      { key, name: key.slice('local/'.length), path: cwd, at: atMs },
    );
    realRepos.push({ key, path: cwd });
    conn.run('UPDATE topics SET repo_key = :rk, updated_at = :at WHERE id = :id', { rk: key, at: atMs, id: tid });
    result.autoRepo += 1;
  }

  // ── 2. board id（b_xxx）→ 组 repos.key ──
  const groupByBoard = new Map<string, string>();
  for (const g of conn.all("SELECT key, ext FROM repos WHERE type = 'group'")) {
    let legacy = '';
    try {
      legacy = String(JSON.parse(String(g.ext || '{}')).ext_legacy_id || '');
    } catch {
      legacy = '';
    }
    if (legacy) groupByBoard.set(legacy, String(g.key));
  }

  // ── 3. 逐 task：frontmatter → repo_key / 组队列，剥正文头 ──
  const tasks = conn.all('SELECT id, topic_id, body FROM tasks');
  for (const task of tasks) {
    const body = String(task.body || '');
    const fm = parseFrontmatter(body);
    if (!Object.keys(fm).length) continue;

    const clean = stripFrontmatter(body);
    conn.run('UPDATE tasks SET body = :b WHERE id = :id', { b: clean, id: Number(task.id) });
    result.stripped += 1;

    const topic = conn.get('SELECT id, key, cwd, name, repo_key FROM topics WHERE id = :id', { id: Number(task.topic_id) });
    if (!topic) continue;

    const projectKey = String(fm.project || '').trim();
    const repoKey = projectKey && conn.get('SELECT 1 AS ok FROM repos WHERE key = :k', { k: projectKey })
      ? projectKey
      : String(topic.repo_key || '');

    const boardId = String(fm.board || '').trim();
    const groupKey = boardId ? groupByBoard.get(boardId) || '' : '';

    if (groupKey) {
      // 组任务拆到 (cwd, group_key) 独立队列
      const cwd = String(topic.cwd || '');
      const newKey = topicKeyOf(cwd, groupKey);
      let host = conn.get('SELECT id FROM topics WHERE key = :k', { k: newKey });
      if (!host) {
        conn.run(
          `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                               deleted_at, created_at, updated_at)
           VALUES (:key, :repo, :cwd, :group, :name, 1, '{}', '', 0, NULL, :at, :at)`,
          { key: newKey, repo: repoKey, cwd, group: groupKey, name: String(topic.name || ''), at: atMs },
        );
        host = conn.get('SELECT id FROM topics WHERE key = :k', { k: newKey });
      }
      conn.run('UPDATE tasks SET topic_id = :tid, repo_key = :rk WHERE id = :id', {
        tid: Number(host.id), rk: repoKey, id: Number(task.id),
      });
      result.moved += 1;
    } else {
      conn.run('UPDATE tasks SET repo_key = :rk WHERE id = :id', { rk: repoKey, id: Number(task.id) });
    }
  }

  // ── 4. 非组任务补齐 repo_key ──
  conn.run(
    `UPDATE tasks SET repo_key = (SELECT repo_key FROM topics t WHERE t.id = tasks.topic_id)
      WHERE repo_key = '' AND EXISTS (SELECT 1 FROM topics t WHERE t.id = tasks.topic_id)`,
  );

  return result;
}

/** v15 → v16：先归一归属，再删哨兵仓库行。 */
export function migrateAssignmentsToColumns(
  conn: any,
  ctx: V16Context = {},
): V16Result {
  const result = normalizeAssignments(conn, ctx);
  const del = conn.run("DELETE FROM repos WHERE key = '__unbound__'");
  result.sentinelRemoved = Number(del.changes) || 0;
  return result;
}
