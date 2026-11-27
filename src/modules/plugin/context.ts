// 插件上下文解析：把前端传的定位信息 + DB 里的 topic/repo/group 合成完整上下文。
//
// 插件缺东西时还可以走 GET /api/plugins/context 或 tree/file 自行构造内容；
// 这里只做「已知定位 → 完整快照」，不暴露宿主内部对象。
import type { PluginLocation, PluginTopicInfo, PretaskContext } from '@nx-kv/plugin-sdk';
import { db } from './repo/db.js';

export interface RepoView {
  key: string;
  type: string;
  name: string;
  path: string;
  description: string;
}

export interface PluginContextView {
  topic: PluginTopicInfo;
  repo: RepoView | null;
  group: RepoView | null;
  repos: RepoView[];
}

interface TopicRow {
  key: string;
  repo_key: string;
  cwd: string;
  group_key: string;
  name: string;
}

const STRING_KEYS = [
  'topicKey', 'groupKey', 'repoKey', 'cwd', 'dirKey', 'groupId', 'board', 'project',
] as const;
const LOCATION_KEYS = ['dirKey', 'groupId', 'board', 'project', 'taskId'] as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 1000) : '';
}

/** 只收白名单字段，避免把任意 JS 对象透传给插件 server。 */
export function sanitizeContext(raw: unknown): PretaskContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: PretaskContext = {};
  for (const key of STRING_KEYS) {
    const value = text(src[key]);
    if (value) out[key] = value;
  }
  const topicRaw = src.topic;
  if (topicRaw && typeof topicRaw === 'object' && !Array.isArray(topicRaw)) {
    const t = topicRaw as Record<string, unknown>;
    const kind = t.kind === 'repo' || t.kind === 'group' || t.kind === 'unknown' ? t.kind : 'unknown';
    const topic: PluginTopicInfo = {
      key: text(t.key),
      name: text(t.name),
      kind,
      cwd: text(t.cwd),
      repoKey: text(t.repoKey),
      groupKey: text(t.groupKey),
      repoName: text(t.repoName),
      groupName: text(t.groupName),
      repoRoot: text(t.repoRoot),
    };
    out.topic = topic;
  }
  const locRaw = src.location;
  if (locRaw && typeof locRaw === 'object' && !Array.isArray(locRaw)) {
    const l = locRaw as Record<string, unknown>;
    const location: PluginLocation = {};
    for (const key of LOCATION_KEYS) {
      const value = text(l[key]);
      if (value) location[key] = value;
    }
    out.location = location;
  }
  return out;
}

export function repoRowOf(key: string, conn = db()): RepoView | null {
  if (!key) return null;
  const row = conn.get(
    `SELECT key, type, name, path, description
       FROM repos WHERE key = :key AND deleted_at IS NULL`,
    { key },
  );
  return row
    ? {
        key: String(row.key),
        type: String(row.type || ''),
        name: String(row.name || ''),
        path: String(row.path || ''),
        description: String(row.description || ''),
      }
    : null;
}

export function groupRepos(groupKey: string, conn = db()): RepoView[] {
  if (!groupKey) return [];
  return conn
    .all(
      `SELECT r.key, r.type, r.name, r.path, r.description
         FROM repo_group_members m
         JOIN repos r ON r.key = m.repo_key
        WHERE m.group_key = :g AND r.type = 'repo' AND r.deleted_at IS NULL
        ORDER BY m.position, r.name`,
      { g: groupKey },
    )
    .map((r) => ({
      key: String(r.key),
      type: String(r.type || 'repo'),
      name: String(r.name || ''),
      path: String(r.path || ''),
      description: String(r.description || ''),
    }));
}

/** 已知定位 → 完整上下文（DB 优先，前端传值兜底）。 */
export function resolvePluginContext(ctx: PretaskContext, conn = db()): PretaskContext {
  const src = ctx || {};
  const topicKey = text(src.topicKey) || text(src.topic?.key);
  let topicRow: TopicRow | null = null;
  if (topicKey) {
    const row = conn.get(
      `SELECT key, repo_key, cwd, group_key, name
         FROM topics WHERE key = :key AND deleted_at IS NULL`,
      { key: topicKey },
    );
    if (row) {
      topicRow = {
        key: String(row.key),
        repo_key: String(row.repo_key || ''),
        cwd: String(row.cwd || ''),
        group_key: String(row.group_key || ''),
        name: String(row.name || ''),
      };
    }
  }

  const repoKey = topicRow?.repo_key || text(src.repoKey) || text(src.topic?.repoKey);
  let groupKey = topicRow?.group_key || text(src.groupKey) || text(src.topic?.groupKey);
  const cwd = topicRow?.cwd || text(src.cwd) || text(src.topic?.cwd);
  let repo = repoKey ? repoRowOf(repoKey, conn) : null;
  let group = groupKey ? repoRowOf(groupKey, conn) : null;
  // group-level topic 可能把 repo_key 指到组本身：归一到 group，成员 repo 由 repos 列表给。
  if (!group && repo?.type === 'group') {
    group = repo;
    groupKey = repo.key;
    repo = null;
  }
  // 前端显式声明了页面性质（目录页=repo / 组页=group）时以它为准：
  // 同一个带 group_key 的成员 topic 在目录页仍按仓库看，只在组页给组语义。
  const declared = src.topic?.kind;
  const kind: PluginTopicInfo['kind'] =
    declared === 'repo' || declared === 'group' || declared === 'unknown'
      ? declared
      : group
        ? 'group'
        : repo
          ? 'repo'
          : 'unknown';
  const topic: PluginTopicInfo = {
    key: topicKey,
    name:
      text(topicRow?.name) ||
      text(src.topic?.name) ||
      group?.name ||
      repo?.name ||
      '',
    kind,
    cwd,
    repoKey: repo?.key || '',
    groupKey,
    repoName: repo?.name || '',
    groupName: group?.name || '',
    repoRoot: repo?.path || '',
  };
  return {
    ...src,
    topicKey,
    groupKey,
    repoKey: repo?.key || '',
    cwd,
    topic,
    location: src.location || {},
  };
}

/** /api/plugins/context 的返回：topic + 当前 repo/group + 组内 repo 列表。 */
export function pluginContextView(ctx: PretaskContext, conn = db()): PluginContextView {
  const resolved = resolvePluginContext(ctx, conn);
  const topic = resolved.topic!;
  const repo = topic.repoKey ? repoRowOf(topic.repoKey, conn) : null;
  const group = topic.groupKey ? repoRowOf(topic.groupKey, conn) : null;
  const repos = group ? groupRepos(group.key, conn) : repo ? [repo] : [];
  return { topic, repo, group, repos };
}
