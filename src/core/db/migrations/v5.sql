-- schema v5：附件新增 kind='mdfile'（本地 md 文件指针）与 storage='external'
--
-- 设计口径（2026-11-12，docs/decisions/2026-11-12-refs-body-in-db.md §2.4 / §5）：
--   · mdfile 是**独立资源类型**，不是 kind='file' + MIME 判定：
--       字节留在用户磁盘原地（storage='external'），库里只存路径指针 + 内容指纹；
--       web 端按 kind 分支走 md 渲染，不走通用文件的下载/预览路径。
--   · 身份沿用 att_<kind>_<hash16> 家族：id = att_mdfile_<sha1(规范化绝对路径)>。
--   · 新增列只服务 mdfile，其它 kind 一律留空/0（无默认值以外的语义）。
--
-- SQLite 不能 ALTER 既有的 CHECK 约束 → 只能 12-step 重建 attachments。
--
-- **DROP TABLE 会级联删子表**（实测，不是理论风险）：外键启用时 DROP TABLE 会做
-- 一次隐式 DELETE，并立刻触发子表的 ON DELETE CASCADE；`defer_foreign_keys`
-- 只推迟约束**校验**，不推迟级联**动作**。所以关系表必须先快照、重建后回填，
-- 否则 task_attach / ref_attach 会被静默清空（且 foreign_key_check 仍为干净）。
-- 回填用显式列名，不依赖列序。
--
-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
PRAGMA defer_foreign_keys = ON;

-- 关系表快照（TEMP，随连接生命周期；迁移结束立即 DROP）
CREATE TEMP TABLE _v5_task_attach AS
  SELECT task_id, attachment_id, role, position, note, created_at FROM task_attach;
CREATE TEMP TABLE _v5_ref_attach AS
  SELECT ref_id, attachment_id, role, position, note, created_at FROM ref_attach;

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
CREATE TABLE attachments_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('file', 'url', 'task', 'ref', 'mdfile')),
  name          TEXT NOT NULL DEFAULT '',
  -- 本机/云端文件本轮实际可读的绝对路径；云端缓存未下载时为空。
  -- mdfile 不用这一列（见 abs_path），保持为空。
  local_path    TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  hash          TEXT NOT NULL DEFAULT '',
  -- file 的存储位置：local=本机附件仓，cloud=云端镜像缓存；
  -- mdfile 固定 external（字节不在库里）。
  storage       TEXT NOT NULL DEFAULT '' CHECK (storage IN ('', 'local', 'cloud', 'external')),
  group_id      INTEGER NOT NULL DEFAULT 0,
  -- 内部资源的定位信息（kind=task/ref 时有值；file/url/mdfile 为空）
  target_kind   TEXT NOT NULL DEFAULT '' CHECK (target_kind IN ('', 'task', 'ref')),
  target_key    TEXT NOT NULL DEFAULT '',
  target_seq    INTEGER,
  dedupe_key    TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(meta) AND json_type(meta) = 'object'),
  -- mdfile 专用（其它 kind 留空/0）
  abs_path      TEXT NOT NULL DEFAULT '',   -- 规范化后的绝对路径（唯一性基础）
  anchor_dir    TEXT NOT NULL DEFAULT '',   -- 相对链接锚点 = 登记时文件所在目录
  missing_at    INTEGER,                    -- 上次确认文件不存在的时间（不软删）
  last_seen_at  INTEGER,                    -- 上次读到时文件仍在（且 hash 未变）的时间
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

INSERT INTO attachments_new (
  id, kind, name, local_path, url, mime, size, hash, storage,
  group_id, target_kind, target_key, target_seq, dedupe_key, meta,
  abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at
)
SELECT id, kind, name, local_path, url, mime, size, hash, storage,
       group_id, target_kind, target_key, target_seq, dedupe_key, meta,
       '', '', NULL, NULL, deleted_at, created_at, updated_at
  FROM attachments;

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
DROP TABLE attachments;

ALTER TABLE attachments_new RENAME TO attachments;

-- v2 的 3 个索引原样重建（DROP TABLE 时随表消失）
CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_dedupe
  ON attachments (dedupe_key)
  WHERE dedupe_key <> '' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_attachments_kind
  ON attachments (kind, deleted_at);
CREATE INDEX IF NOT EXISTS ix_attachments_target
  ON attachments (target_kind, target_key, target_seq);
CREATE INDEX IF NOT EXISTS ix_attachments_group
  ON attachments (storage, group_id, deleted_at);

-- mdfile 路径唯一：同一外部文件只登记一行（软删后允许重新登记）
CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_mdfile_path
  ON attachments (abs_path COLLATE NOCASE)
  WHERE kind = 'mdfile' AND deleted_at IS NULL;

-- 回填关系表（DROP 时已被 CASCADE 删掉，此处按快照逐行恢复；显式列名）
INSERT INTO task_attach (task_id, attachment_id, role, position, note, created_at)
SELECT task_id, attachment_id, role, position, note, created_at FROM _v5_task_attach;
INSERT INTO ref_attach (ref_id, attachment_id, role, position, note, created_at)
SELECT ref_id, attachment_id, role, position, note, created_at FROM _v5_ref_attach;

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
DROP TABLE _v5_task_attach;
-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
DROP TABLE _v5_ref_attach;
