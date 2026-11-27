-- v19：内部插件宿主的四张宿主表。
--
-- 插件自己的业务表不在这里：由插件包的 migrateStorage(db, fromVersion) 创建，
-- 宿主只记 plugin_storage_migrations 的版本号。本文件只建宿主级数据：
--   plugin_state              全局开关（缺行 = 用 manifest defaultEnabled）
--   plugin_entry_visibility   每个 scope 的入口可见性/顺序（缺行 = 可见）
--   plugin_legacy_data        旧内置能力的迁移暂存（task-template 从这里取 v18 templates）
--   plugin_storage_migrations 插件自有表结构的版本账本
-- @decision docs/decisions/versions/2026-11-27-v19.md
-- @decision docs/decisions/versions/2026-11-27-v19.md
CREATE TABLE IF NOT EXISTS plugin_state (
  plugin_id  TEXT    PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- @decision docs/decisions/versions/2026-11-27-v19.md
CREATE TABLE IF NOT EXISTS plugin_entry_visibility (
  scope_key  TEXT    NOT NULL,             -- topic:<key> / repo:<key> / group:<key>
  entry_id   TEXT    NOT NULL,             -- <pluginId>:<localId>
  visible    INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_key, entry_id)
);

-- @decision docs/decisions/versions/2026-11-27-v19.md
CREATE TABLE IF NOT EXISTS plugin_legacy_data (
  plugin_id   TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  payload_json TEXT   NOT NULL CHECK (json_valid(payload_json)),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, kind)
);

-- @decision docs/decisions/versions/2026-11-27-v19.md
CREATE TABLE IF NOT EXISTS plugin_storage_migrations (
  plugin_id  TEXT    PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  applied_at INTEGER NOT NULL
);
