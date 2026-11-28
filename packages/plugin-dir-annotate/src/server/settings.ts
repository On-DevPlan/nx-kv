// 目录批注插件的自有设置表（插件包自己的结构，宿主只记版本号）。
import type { PluginDb } from '@nx-kv/plugin-sdk';
import { DEFAULT_PROMPT_HEAD, DEFAULT_PROMPT_TAIL, migrateRequirements } from './requirements.js';

export interface DirAnnotateSettings {
  /** 文件树是否显示以 . 开头的隐藏项 */
  showHidden: boolean;
  /** 生成任务正文时是否带「当前目录」 */
  includeDir: boolean;
  /** 生成任务标题前缀（如「【批注】」），空 = 不加 */
  titlePrefix: string;
  /** 目录要求提示词开头（支持 {{repoName}} / {{entryCount}}） */
  promptHead: string;
  /** 目录要求提示词结尾 */
  promptTail: string;
}

export const STORAGE_VERSION = 3;

const DEFAULTS: DirAnnotateSettings = {
  showHidden: false,
  includeDir: true,
  titlePrefix: '',
  promptHead: DEFAULT_PROMPT_HEAD,
  promptTail: DEFAULT_PROMPT_TAIL,
};

export function migrateStorage(db: PluginDb, fromVersion: number): number {
  if (fromVersion < 1) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS dir_annotate_settings (
         id           INTEGER PRIMARY KEY CHECK (id = 1),
         show_hidden  INTEGER NOT NULL DEFAULT 0 CHECK (show_hidden IN (0, 1)),
         include_dir  INTEGER NOT NULL DEFAULT 1 CHECK (include_dir IN (0, 1)),
         title_prefix TEXT    NOT NULL DEFAULT '',
         updated_at   INTEGER NOT NULL
       )`,
    );
  }
  // v2：目录要求条目（按仓库）+ 主题启用列表（按主题）。
  if (fromVersion < 2) migrateRequirements(db);
  // v3：目录要求的提示词开头 / 结尾可配置（空 = 出厂默认）。
  if (fromVersion < 3) {
    db.exec("ALTER TABLE dir_annotate_settings ADD COLUMN prompt_head TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE dir_annotate_settings ADD COLUMN prompt_tail TEXT NOT NULL DEFAULT ''");
  }
  return STORAGE_VERSION;
}

function truthy(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'off');
}

export function readSettings(db: PluginDb): DirAnnotateSettings {
  const row = db.get(
    'SELECT show_hidden, include_dir, title_prefix, prompt_head, prompt_tail FROM dir_annotate_settings WHERE id = 1',
  );
  if (!row) return { ...DEFAULTS };
  return {
    showHidden: !!Number(row.show_hidden),
    includeDir: !!Number(row.include_dir),
    titlePrefix: String(row.title_prefix || ''),
    promptHead: String(row.prompt_head || '') || DEFAULT_PROMPT_HEAD,
    promptTail: String(row.prompt_tail || '') || DEFAULT_PROMPT_TAIL,
  };
}

const MAX_PROMPT_LEN = 4000;

/** 合并写入；只认这些字段，titlePrefix 截到 40 字，提示词头尾截到 4000 字。 */
export function writeSettings(db: PluginDb, patch: Record<string, unknown>): DirAnnotateSettings {
  const cur = readSettings(db);
  const next: DirAnnotateSettings = {
    showHidden: truthy(patch.showHidden, cur.showHidden),
    includeDir: truthy(patch.includeDir, cur.includeDir),
    titlePrefix: patch.titlePrefix === undefined
      ? cur.titlePrefix
      : String(patch.titlePrefix || '').trim().slice(0, 40),
    promptHead: patch.promptHead === undefined
      ? cur.promptHead
      : String(patch.promptHead || '').trim().slice(0, MAX_PROMPT_LEN),
    promptTail: patch.promptTail === undefined
      ? cur.promptTail
      : String(patch.promptTail || '').trim().slice(0, MAX_PROMPT_LEN),
  };
  db.run(
    `INSERT INTO dir_annotate_settings (id, show_hidden, include_dir, title_prefix, prompt_head, prompt_tail, updated_at)
     VALUES (1, :hide, :dir, :prefix, :head, :tail, :at)
     ON CONFLICT(id) DO UPDATE SET
       show_hidden = excluded.show_hidden,
       include_dir = excluded.include_dir,
       title_prefix = excluded.title_prefix,
       prompt_head = excluded.prompt_head,
       prompt_tail = excluded.prompt_tail,
       updated_at = excluded.updated_at`,
    {
      hide: next.showHidden ? 1 : 0,
      dir: next.includeDir ? 1 : 0,
      prefix: next.titlePrefix,
      head: next.promptHead,
      tail: next.promptTail,
      at: Date.now(),
    },
  );
  return next;
}
