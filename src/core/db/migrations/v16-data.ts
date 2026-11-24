// schema v15 → v16 的数据迁移（与 v16.sql 同一事务执行）：#197
//
// 三件事，全部围绕「归属从正文 frontmatter 搬进库内关联」：
//   1. 哨兵队列重绑：repo_key='__unbound__' 的 topic 按 cwd 匹配已登记仓库；
//      匹配不到且目录还在 → 自动登记为仓库（key=local/<目录名>）；目录已消失 → 连任务删除。
//   2. 组归属落库：带 board 的任务给建/找一条 group topic（key='group:<组key>'），
//      写 tasks.group_topic_id；组的 id（b_xxx）经 repos.ext.ext_legacy_id 反查。
//   3. 剥正文头：正文只留 markdown（标题 + 内容），归属全部在关联里。
//   4. 删除哨兵仓库行（此时已无 topic 引用它，FK 不会级联删数据）。
//
// 注意：编号序列不迁移——seq 仍挂在 repo_topic_id 上，与改造前完全一致。
//
// 约束：core 层不得 import modules —— 仓库匹配用 core 的纯函数。
import { matchRepoKey, autoRepoKey } from '../repo-match.js';

// core 是最底层，不能反向 import shared —— 这里保留一份最小的 frontmatter 读/剥实现
// （与 shared/frontmatter.js 同口径；attachmentdb/resources.ts 也有同款最小实现）。
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
  grouped: number;
  groupTopics: number;
  sentinelRemoved: number;
}

export function normalizeAssignments(
  conn: any,
  { atMs = Date.now() }: V16Context = {},
): V16Result {
  const result: V16Result = {
    rebound: 0, autoRepo: 0, droppedTopic: 0, stripped: 0, grouped: 0, groupTopics: 0, sentinelRemoved: 0,
  };

  // ── 1. 哨兵队列重绑（必须早于删除哨兵行：DELETE repos 会 CASCADE 删 topic）──
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
    // 匹配不到就自动登记为仓库（哪怕目录已不在）——**绝不因为「找不到归属」丢任务**。
    // 目录为空的行没有归属语义，才丢弃（#190 前的全局池残迹）。
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

  // ── 2. board id（b_xxx）→ 组 repos.key（group/xxx）+ 组名 ──
  const groupByBoard = new Map<string, { key: string; name: string }>();
  for (const g of conn.all("SELECT key, name, ext FROM repos WHERE type = 'group'")) {
    let legacy = '';
    try {
      legacy = String(JSON.parse(String(g.ext || '{}')).ext_legacy_id || '');
    } catch {
      legacy = '';
    }
    if (legacy) groupByBoard.set(legacy, { key: String(g.key), name: String(g.name || '') });
  }

  /** 找/建组队列 topic（key = 'group:<组key>'，cwd 空，repo_key 指向组行）。 */
  const groupTopicOf = (groupKey: string, groupName: string): number | null => {
    const key = `group:${groupKey}`;
    const hit = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    if (hit) return Number(hit.id);
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, :repo, '', :group, :name, 1, '{}', '', 0, NULL, :at, :at)`,
      { key, repo: groupKey, group: groupKey, name: groupName || groupKey, at: atMs },
    );
    result.groupTopics += 1;
    const created = conn.get('SELECT id FROM topics WHERE key = :k', { k: key });
    return created ? Number(created.id) : null;
  };

  // ── 3. 逐 task：提取 board → group_topic_id，剥正文头 ──
  const tasks = conn.all('SELECT id, repo_topic_id, body FROM tasks');
  for (const task of tasks) {
    const body = String(task.body || '');
    const fm = parseFrontmatter(body);
    if (!Object.keys(fm).length) continue;

    const clean = stripFrontmatter(body);
    conn.run('UPDATE tasks SET body = :b WHERE id = :id', { b: clean, id: Number(task.id) });
    result.stripped += 1;

    const boardId = String(fm.board || '').trim();
    const group = boardId ? groupByBoard.get(boardId) : undefined;
    if (group) {
      const gtid = groupTopicOf(group.key, group.name);
      if (gtid) {
        conn.run('UPDATE tasks SET group_topic_id = :g WHERE id = :id', { g: gtid, id: Number(task.id) });
        result.grouped += 1;
      }
    }
  }

  return result;
}

/** v15 → v16：先归一归属，再删哨兵仓库行（此时已无 topic 引用，CASCADE 不会误删）。 */
export function migrateAssignmentsToColumns(
  conn: any,
  ctx: V16Context = {},
): V16Result {
  const result = normalizeAssignments(conn, ctx);
  const del = conn.run("DELETE FROM repos WHERE key = '__unbound__'");
  result.sentinelRemoved = Number(del.changes) || 0;
  return result;
}
