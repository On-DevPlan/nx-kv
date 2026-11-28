// 目录要求：条目按仓库保存，启用列表按主题保存。
//
// 为什么分两层：
//   · 条目（目录 + 标题 + 要求正文）是仓库的资产，同一仓库的所有主题共用；
//   · 「这个主题要落实哪些条目」是主题自己的选择，跟随主题领取走；
//   · 默认不启用——用户逐条启用后，才写进任务领取提示词。
//
// 表名前缀沿用插件现有风格（dir_annotate_*），宿主只记 storageVersion，不认识列。
import type { PluginDb } from '@nx-kv/plugin-sdk';
import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

export const MAX_REQUIREMENTS_PER_REPO = 50;
export const MAX_SELECTED = 100;
const ID_RE = /^req_[a-z0-9]{4,40}$/;
const MAX_KEY_LEN = 300;
const MAX_DIR_LEN = 500;
const MAX_TITLE_LEN = 80;
const MAX_DETAIL_LEN = 4000;

/**
 * 出厂提示词开头 / 结尾（设置页可改）。
 * 支持 {{repoName}} 与 {{entryCount}} 两个占位符。
 * 客户端 SettingsPage 里有一份同文本的默认值，改这里时两处同步。
 */
export const DEFAULT_PROMPT_HEAD = `〔目录要求 · {{repoName}}〕
本主题启用了 {{entryCount}} 条目录维护要求。完成本任务后，必须逐条检查并更新对应目录 / 文件中的内容与文档，确保交付时保持最新：`;

export const DEFAULT_PROMPT_TAIL = `若某条要求本次确实不适用或无法完成，必须在完成总结里逐条说明原因，不得静默跳过。`;

export interface DirRequirement {
  id: string;
  repoKey: string;
  dir: string;
  title: string;
  detail: string;
  position: number;
}

export interface DirRequirementInput {
  id?: unknown;
  dir?: unknown;
  title?: unknown;
  detail?: unknown;
}

/** v2：目录要求条目 + 主题启用列表。 */
export function migrateRequirements(db: PluginDb): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS dir_annotate_requirements (
       id         TEXT PRIMARY KEY,
       repo_key   TEXT    NOT NULL,
       dir        TEXT    NOT NULL,
       title      TEXT    NOT NULL,
       detail     TEXT    NOT NULL,
       position   INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS ix_dir_annotate_requirements_repo
       ON dir_annotate_requirements (repo_key, position, id)`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS dir_annotate_topic_requirements (
       topic_key  TEXT PRIMARY KEY,
       req_ids    TEXT NOT NULL DEFAULT '[]',
       updated_at INTEGER NOT NULL
     )`,
  );
}

function textField(raw: unknown, label: string, max: number, required: boolean): string {
  const value = String(raw ?? '').trim();
  if (required && !value) throw new Error(`${label}不能为空`);
  if (value.length > max) throw new Error(`${label}最多 ${max} 字`);
  return value;
}

/** 仓库 / 主题 key 是外部输入：只做长度与空值校验，具体格式由宿主派生。 */
export function repoKeyOf(raw: unknown): string {
  const key = textField(raw, '仓库 key（repoKey）', MAX_KEY_LEN, true);
  return key;
}

export function topicKeyOf(raw: unknown): string {
  return textField(raw, '主题 key（topicKey）', MAX_KEY_LEN, true);
}

function rowOf(row: Record<string, unknown>): DirRequirement {
  return {
    id: String(row.id),
    repoKey: String(row.repo_key),
    dir: String(row.dir),
    title: String(row.title),
    detail: String(row.detail),
    position: Number(row.position) || 0,
  };
}

export function listRequirements(db: PluginDb, rawRepoKey: unknown): DirRequirement[] {
  const repoKey = repoKeyOf(rawRepoKey);
  return db
    .all(
      `SELECT id, repo_key, dir, title, detail, position
         FROM dir_annotate_requirements
        WHERE repo_key = :repo
        ORDER BY position, created_at, id`,
      { repo: repoKey },
    )
    .map(rowOf);
}

function requirementOf(db: PluginDb, repoKey: string, id: string): DirRequirement | null {
  const row = db.get(
    'SELECT id, repo_key, dir, title, detail, position FROM dir_annotate_requirements WHERE id = :id AND repo_key = :repo',
    { id, repo: repoKey },
  );
  return row ? rowOf(row) : null;
}

/**
 * 新建 / 修改一条目录要求。
 * 不传 id = 新建；同一仓库里 dir + title 相同视为同一条（更新而不是多出一条）。
 */
export function saveRequirement(
  db: PluginDb,
  rawRepoKey: unknown,
  input: DirRequirementInput,
): DirRequirement {
  const repoKey = repoKeyOf(rawRepoKey);
  const dir = textField(input.dir, '目录 / 文件', MAX_DIR_LEN, true);
  const title = textField(input.title, '标题', MAX_TITLE_LEN, true);
  const detail = textField(input.detail, '要求正文', MAX_DETAIL_LEN, true);
  const at = Date.now();
  const rawId = String(input.id ?? '').trim();

  if (rawId) {
    if (!ID_RE.test(rawId)) throw new Error(`目录要求 id 非法：${rawId}`);
    if (!requirementOf(db, repoKey, rawId)) throw new Error('要修改的目录要求不存在（可能已被删除）');
    db.run(
      `UPDATE dir_annotate_requirements
          SET dir = :dir, title = :title, detail = :detail, updated_at = :at
        WHERE id = :id AND repo_key = :repo`,
      { id: rawId, repo: repoKey, dir, title, detail, at },
    );
    return requirementOf(db, repoKey, rawId)!;
  }

  const dup = db.get(
    'SELECT id FROM dir_annotate_requirements WHERE repo_key = :repo AND dir = :dir AND title = :title LIMIT 1',
    { repo: repoKey, dir, title },
  );
  if (dup) {
    const id = String(dup.id);
    db.run(
      `UPDATE dir_annotate_requirements
          SET detail = :detail, updated_at = :at
        WHERE id = :id AND repo_key = :repo`,
      { id, repo: repoKey, detail, at },
    );
    return requirementOf(db, repoKey, id)!;
  }

  const count = Number(
    db.get('SELECT count(*) AS c FROM dir_annotate_requirements WHERE repo_key = :repo', { repo: repoKey })?.c || 0,
  );
  if (count >= MAX_REQUIREMENTS_PER_REPO) {
    throw new Error(`每个仓库最多 ${MAX_REQUIREMENTS_PER_REPO} 条目录要求`);
  }
  const next = Number(
    db.get(
      'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM dir_annotate_requirements WHERE repo_key = :repo',
      { repo: repoKey },
    )?.p || 0,
  );
  // id 每次新建都不同：删掉再建不会复活旧的主题启用记录。
  const id = `req_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  db.run(
    `INSERT INTO dir_annotate_requirements (id, repo_key, dir, title, detail, position, created_at, updated_at)
     VALUES (:id, :repo, :dir, :title, :detail, :position, :at, :at)`,
    { id, repo: repoKey, dir, title, detail, position: next, at },
  );
  return requirementOf(db, repoKey, id)!;
}

/** 删除一条目录要求；返回删除后的列表（主题启用记录里的陈旧 id 由读取时过滤）。 */
export function removeRequirement(db: PluginDb, rawRepoKey: unknown, rawId: unknown): DirRequirement[] {
  const repoKey = repoKeyOf(rawRepoKey);
  const id = String(rawId ?? '').trim();
  if (!ID_RE.test(id)) throw new Error(`目录要求 id 非法：${id}`);
  db.run('DELETE FROM dir_annotate_requirements WHERE id = :id AND repo_key = :repo', { id, repo: repoKey });
  return listRequirements(db, repoKey);
}

/** 读一个主题启用的要求 id（没有行 / 坏数据 → 空数组 = 默认不启用）。 */
export function readTopicRequirements(db: PluginDb, rawTopicKey: unknown): string[] {
  const topicKey = topicKeyOf(rawTopicKey);
  const row = db.get('SELECT req_ids FROM dir_annotate_topic_requirements WHERE topic_key = ?', [topicKey]);
  if (!row) return [];
  try {
    const value = JSON.parse(String(row.req_ids || '[]'));
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const id = typeof item === 'string' ? item.trim() : '';
      if (!ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_SELECTED) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 整组覆盖写一个主题的启用列表；空数组 = 删除该主题的行。 */
export function writeTopicRequirements(
  db: PluginDb,
  rawTopicKey: unknown,
  rawIds: unknown,
): string[] {
  const topicKey = topicKeyOf(rawTopicKey);
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawIds)) {
    for (const item of rawIds) {
      const id = typeof item === 'string' ? item.trim() : '';
      if (!ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_SELECTED) break;
    }
  }
  if (!out.length) {
    db.run('DELETE FROM dir_annotate_topic_requirements WHERE topic_key = ?', [topicKey]);
    return out;
  }
  db.run(
    `INSERT INTO dir_annotate_topic_requirements (topic_key, req_ids, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(topic_key) DO UPDATE SET req_ids = excluded.req_ids, updated_at = excluded.updated_at`,
    [topicKey, JSON.stringify(out), Date.now()],
  );
  return out;
}

function resolveDir(repoRoot: string, dir: string): string {
  const value = String(dir || '').trim();
  if (!value) return '';
  if (isAbsolute(value) || !repoRoot) return value;
  return resolve(repoRoot, value);
}

/** 只替换设置页支持的占位符，其余文本原样保留。 */
function fillSurround(text: string, vars: { repoName: string; entryCount: number }): string {
  return String(text || '').replace(/\{\{\s*(repoName|entryCount)\s*\}\}/g, (_all, key: string) =>
    key === 'repoName' ? vars.repoName : String(vars.entryCount),
  );
}

/**
 * 插件内部直接生成完整提示词（不依赖全局模板逐条拼装）：
 * 全局模板只拿 `{{prompt}}`，内容随主题 / 仓库 / 启用条目变化。
 * 开头 / 结尾文案来自插件设置页（空 → 出厂默认）。
 */
export function buildRequirementsPrompt(input: {
  repoName: string;
  repoKey: string;
  repoRoot: string;
  entries: readonly DirRequirement[];
  promptHead?: string;
  promptTail?: string;
}): string {
  const { repoName, repoKey, repoRoot, entries } = input;
  const displayName = repoName || repoKey;
  const head = fillSurround(input.promptHead || DEFAULT_PROMPT_HEAD, {
    repoName: displayName,
    entryCount: entries.length,
  }).trim();
  const tail = fillSurround(input.promptTail === undefined ? DEFAULT_PROMPT_TAIL : input.promptTail, {
    repoName: displayName,
    entryCount: entries.length,
  }).trim();
  const lines: string[] = [];
  if (head) lines.push(head, '');
  entries.forEach((entry, index) => {
    const abs = resolveDir(repoRoot, entry.dir);
    lines.push(`${index + 1}. ${entry.title}`);
    lines.push(`   位置：${abs || entry.dir}${abs && abs !== entry.dir ? `（仓库内 ${entry.dir}）` : ''}`);
    const detail = String(entry.detail || '').trim();
    if (detail) {
      const parts = detail.split(/\r?\n/);
      lines.push(`   要求：${parts[0]}`);
      for (const extra of parts.slice(1)) lines.push(`         ${extra}`);
    }
    lines.push('');
  });
  if (tail) lines.push(tail);
  return lines.join('\n').trim();
}
