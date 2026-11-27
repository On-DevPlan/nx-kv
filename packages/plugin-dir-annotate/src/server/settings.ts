// 目录批注插件的自有设置表（插件包自己的结构，宿主只记版本号）。
import type { PluginDb } from '@nx-kv/plugin-sdk';

export interface DirAnnotateSettings {
  /** 文件树是否显示以 . 开头的隐藏项 */
  showHidden: boolean;
  /** 生成任务正文时是否带「当前目录」 */
  includeDir: boolean;
  /** 生成任务标题前缀（如「【批注】」），空 = 不加 */
  titlePrefix: string;
}

export const STORAGE_VERSION = 1;

const DEFAULTS: DirAnnotateSettings = { showHidden: false, includeDir: true, titlePrefix: '' };

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
  return STORAGE_VERSION;
}

function truthy(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'off');
}

export function readSettings(db: PluginDb): DirAnnotateSettings {
  const row = db.get('SELECT show_hidden, include_dir, title_prefix FROM dir_annotate_settings WHERE id = 1');
  if (!row) return { ...DEFAULTS };
  return {
    showHidden: !!Number(row.show_hidden),
    includeDir: !!Number(row.include_dir),
    titlePrefix: String(row.title_prefix || ''),
  };
}

/** 合并写入；只认三个字段，titlePrefix 截到 40 字。 */
export function writeSettings(db: PluginDb, patch: Record<string, unknown>): DirAnnotateSettings {
  const cur = readSettings(db);
  const next: DirAnnotateSettings = {
    showHidden: truthy(patch.showHidden, cur.showHidden),
    includeDir: truthy(patch.includeDir, cur.includeDir),
    titlePrefix: patch.titlePrefix === undefined
      ? cur.titlePrefix
      : String(patch.titlePrefix || '').trim().slice(0, 40),
  };
  db.run(
    `INSERT INTO dir_annotate_settings (id, show_hidden, include_dir, title_prefix, updated_at)
     VALUES (1, :hide, :dir, :prefix, :at)
     ON CONFLICT(id) DO UPDATE SET
       show_hidden = excluded.show_hidden,
       include_dir = excluded.include_dir,
       title_prefix = excluded.title_prefix,
       updated_at = excluded.updated_at`,
    {
      hide: next.showHidden ? 1 : 0,
      dir: next.includeDir ? 1 : 0,
      prefix: next.titlePrefix,
      at: Date.now(),
    },
  );
  return next;
}
