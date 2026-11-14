-- schema v10：附件新增 kind='folder'（本地文件夹路径指针）
--
-- 口径（#127）：文件夹和 mdfile 一样是**外部路径指针**——字节（目录内容）不入库、
-- 不复制、不打包，只登记一个规范化绝对路径 + 展示名；交付时把路径给 agent，
-- 由它自己按需列目录 / 读文件。文件夹没有字节，size=0 / hash='' / mime=''。
--
-- SQLite 不能 ALTER 既有 CHECK → 按 v5 的 12-step 模式重建 attachments。
-- DROP TABLE 会级联删 task_attach / ref_attach 的行（defer_foreign_keys 只推迟
-- 校验、不推迟级联动作），所以先 TEMP 快照、DROP 前清空、重建后按显式列名回填。
--
-- @decision docs/decisions/2026-11-14-folder-attachment.md
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE _v10_task_attach AS
  SELECT task_id, attachment_id, role, position, note, created_at FROM task_attach;
CREATE TEMP TABLE _v10_ref_attach AS
  SELECT ref_id, attachment_id, role, position, note, created_at FROM ref_attach;

-- @decision docs/decisions/2026-11-14-folder-attachment.md
CREATE TABLE attachments_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('file', 'url', 'task', 'ref', 'mdfile', 'folder')),
  name          TEXT NOT NULL DEFAULT '',
  local_path    TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  hash          TEXT NOT NULL DEFAULT '',
  storage       TEXT NOT NULL DEFAULT '' CHECK (storage IN ('', 'local', 'cloud', 'external')),
  group_id      INTEGER NOT NULL DEFAULT 0,
  target_kind   TEXT NOT NULL DEFAULT '' CHECK (target_kind IN ('', 'task', 'ref')),
  target_key    TEXT NOT NULL DEFAULT '',
  target_seq    INTEGER,
  dedupe_key    TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(meta) AND json_type(meta) = 'object'),
  abs_path      TEXT NOT NULL DEFAULT '',
  anchor_dir    TEXT NOT NULL DEFAULT '',
  missing_at    INTEGER,
  last_seen_at  INTEGER,
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

INSERT INTO attachments_new (
  id, kind, name, local_path, url, mime, size, hash, storage, group_id,
  target_kind, target_key, target_seq, dedupe_key, meta,
  abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at
)
SELECT
  id, kind, name, local_path, url, mime, size, hash, storage, group_id,
  target_kind, target_key, target_seq, dedupe_key, meta,
  abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at
  FROM attachments;

-- @decision docs/decisions/2026-11-14-folder-attachment.md
DROP TABLE attachments;

ALTER TABLE attachments_new RENAME TO attachments;

CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_dedupe
  ON attachments (dedupe_key) WHERE dedupe_key <> '' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_attachments_kind ON attachments (kind, deleted_at);
CREATE INDEX IF NOT EXISTS ix_attachments_target ON attachments (target_kind, target_key, target_seq);
CREATE INDEX IF NOT EXISTS ix_attachments_group ON attachments (storage, group_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_mdfile_path
  ON attachments (abs_path COLLATE NOCASE)
  WHERE kind = 'mdfile' AND deleted_at IS NULL;
-- 同一文件夹路径（大小写不敏感）只登记一行；mdfile 与 folder 各自独立
CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_folder_path
  ON attachments (abs_path COLLATE NOCASE)
  WHERE kind = 'folder' AND deleted_at IS NULL;

-- DROP TABLE 是否级联取决于连接上的 foreign_keys：先清空再回填，两种情形都不重不漏
DELETE FROM task_attach;
DELETE FROM ref_attach;
INSERT OR REPLACE INTO task_attach (task_id, attachment_id, role, position, note, created_at)
SELECT task_id, attachment_id, role, position, note, created_at FROM _v10_task_attach;
INSERT OR REPLACE INTO ref_attach (ref_id, attachment_id, role, position, note, created_at)
SELECT ref_id, attachment_id, role, position, note, created_at FROM _v10_ref_attach;

-- @decision docs/decisions/2026-11-14-folder-attachment.md
DROP TABLE _v10_task_attach;
-- @decision docs/decisions/2026-11-14-folder-attachment.md
DROP TABLE _v10_ref_attach;
