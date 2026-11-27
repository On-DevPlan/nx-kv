-- v21：plugin_entry_visibility 增加 is_default（每个 scope 一个「新建页」默认入口）。
--
-- 只加列、不重建表：v19 已有行保持原样，is_default 默认 0 = 跟随插件声明的默认；
-- 配了但入口被隐藏时，宿主在 listEntries 里回落到可见入口，不改这里的行。
-- @decision docs/decisions/versions/2026-11-27-v21.md
ALTER TABLE plugin_entry_visibility
  ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
