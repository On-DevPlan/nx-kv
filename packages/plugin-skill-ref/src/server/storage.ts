// skill-ref 插件自有存储：额外技能目录 + 任务级选中技能。
//
// 表名前缀 plugin_skill_ref_；宿主只记 storageVersion，不认识列。
import type { PluginDb } from '@nx-kv/plugin-sdk';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** v2：草稿键表（历史数据只读保留；新任务一律按真实任务号落库）。 */
export const STORAGE_VERSION = 2;
export const MAX_EXTRA_DIRS = 20;
export const MAX_TASK_SKILLS = 100;

export interface SkillRefSettings {
  /** 额外技能目录（绝对路径；可以是 skill 根目录 / .claude 目录 / 单个 skill 目录） */
  extraDirs: string[];
}

const DEFAULTS: SkillRefSettings = { extraDirs: [] };

export function migrateStorage(db: PluginDb, fromVersion: number): number {
  if (fromVersion < 1) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS plugin_skill_ref_settings (
         id         INTEGER PRIMARY KEY CHECK (id = 1),
         extra_dirs TEXT    NOT NULL DEFAULT '[]',
         updated_at INTEGER NOT NULL
       )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS plugin_skill_ref_task_skills (
         task_id    INTEGER PRIMARY KEY,
         skills     TEXT    NOT NULL DEFAULT '[]',
         updated_at INTEGER NOT NULL
       )`,
    );
  }
  if (fromVersion < 2) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS plugin_skill_ref_task_drafts (
         task_key   TEXT PRIMARY KEY,
         skills     TEXT NOT NULL DEFAULT '[]',
         updated_at INTEGER NOT NULL
       )`,
    );
  }
  return STORAGE_VERSION;
}

function expandHome(raw: string): string {
  if (raw === '~') return homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2));
  return raw;
}

function keyOf(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** 外部数据边界：目录必须是绝对路径；去重、去空、限条数。 */
function parseExtraDirs(raw: unknown, strict: boolean): string[] {
  if (!Array.isArray(raw)) {
    if (strict && raw !== undefined && raw !== null) throw new Error('extraDirs 必须是目录数组');
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = expandHome(item.trim());
    if (!text) continue;
    if (!isAbsolute(text)) {
      if (strict) throw new Error(`技能目录必须是绝对路径：${item}`);
      continue;
    }
    const dir = resolve(text);
    const key = keyOf(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
    if (out.length >= MAX_EXTRA_DIRS) {
      if (strict) throw new Error(`最多配置 ${MAX_EXTRA_DIRS} 个技能目录`);
      break;
    }
  }
  return out;
}

export function readSettings(db: PluginDb): SkillRefSettings {
  const row = db.get('SELECT extra_dirs FROM plugin_skill_ref_settings WHERE id = 1');
  if (!row) return { ...DEFAULTS, extraDirs: [] };
  try {
    return { extraDirs: parseExtraDirs(JSON.parse(String(row.extra_dirs || '[]')), false) };
  } catch {
    return { ...DEFAULTS, extraDirs: [] };
  }
}

export function writeSettings(db: PluginDb, patch: Record<string, unknown>): SkillRefSettings {
  const cur = readSettings(db);
  const extraDirs = patch.extraDirs === undefined ? cur.extraDirs : parseExtraDirs(patch.extraDirs, true);
  db.run(
    `INSERT INTO plugin_skill_ref_settings (id, extra_dirs, updated_at)
     VALUES (1, :dirs, :at)
     ON CONFLICT(id) DO UPDATE SET extra_dirs = excluded.extra_dirs, updated_at = excluded.updated_at`,
    { dirs: JSON.stringify(extraDirs), at: Date.now() },
  );
  return { extraDirs };
}

/**
 * 任务键：真实任务号（纯数字）走 task 表；草稿键（历史 draft-N）只读兼容旧数据。
 * 非法键返回 null（读按空、写直接报错）。
 */
function taskKeyOf(raw: unknown): { key: string; taskId: number | null } | null {
  const key = String(raw ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key)) return null;
  const n = /^\d+$/.test(key) ? Number(key) : NaN;
  return { key, taskId: Number.isInteger(n) && n > 0 ? n : null };
}

/** 读一个任务键选中的技能 id（历史草稿键仍可读；没有行 → 空数组）。 */
export function readTaskSkills(db: PluginDb, rawKey: string | number): string[] {
  const info = taskKeyOf(rawKey);
  if (!info) return [];
  const row = info.taskId
    ? db.get('SELECT skills FROM plugin_skill_ref_task_skills WHERE task_id = ?', [info.taskId])
    : db.get('SELECT skills FROM plugin_skill_ref_task_drafts WHERE task_key = ?', [info.key]);
  if (!row) return [];
  try {
    const value = JSON.parse(String(row.skills || '[]'));
    return Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x).slice(0, MAX_TASK_SKILLS) : [];
  } catch {
    return [];
  }
}

/** 整组覆盖写入；空数组 = 删除该键的行。新任务一律用真实任务号（草稿键不再写）。 */
export function writeTaskSkills(db: PluginDb, rawKey: string | number, raw: unknown): string[] {
  const info = taskKeyOf(rawKey);
  if (!info) throw new Error('需要 taskKey（真实任务号）');
  if (!info.taskId) throw new Error('技能引用只能绑定真实任务号（新任务从创建起就有实体）');
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_TASK_SKILLS) break;
    }
  }
  if (!out.length) {
    db.run('DELETE FROM plugin_skill_ref_task_skills WHERE task_id = ?', [info.taskId]);
    return out;
  }
  db.run(
    `INSERT INTO plugin_skill_ref_task_skills (task_id, skills, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET skills = excluded.skills, updated_at = excluded.updated_at`,
    [info.taskId, JSON.stringify(out), Date.now()],
  );
  return out;
}
