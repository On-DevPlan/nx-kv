// 任务模板插件自己的表结构（宿主只记版本号，不认识这些列）。
import type { PluginDb } from '@nx-kv/plugin-sdk';

export const STORAGE_VERSION = 1;

export function migrateStorage(db: PluginDb, fromVersion: number): number {
  if (fromVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_task_templates (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        body         TEXT NOT NULL,
        vars_schema  TEXT NOT NULL DEFAULT '[]',
        vars         TEXT NOT NULL DEFAULT '{}',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        scope        TEXT NOT NULL DEFAULT '[]',
        origin_topic TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS ix_plugin_task_templates_order
        ON plugin_task_templates (sort_order, id) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS plugin_task_template_settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
  return STORAGE_VERSION;
}
