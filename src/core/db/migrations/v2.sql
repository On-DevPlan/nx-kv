-- schema v2：统一资源表 attachments + 任务/文档资源关系
--
-- 设计口径（2026-11-08）：
--   · refs 收窄为「文档库」：只装 .md，locator = docs 树相对路径或外部 .md 绝对路径；
--   · 一切「非文档资源」进 attachments：本机/云端文件、外部 URL、内部 task/ref 引用；
--   · 任务正文 / 文档正文里解析出的资源都落关系表，正文仍是用户可写的快捷入口；
--   · 旧 task_refs（0 行、无写入方、无读取方）与 ref_relations（0 行、无写入方、无读取方）
--     直接删除，不留兼容壳。
--
-- 身份规则（core/attachmentdb.js 是唯一实现）：
--   file  → id = fileId（32+ hex，可带扩展名）；fileId 与 attachments.id 对齐，
--           所以正文 `![名](fileId)` / `[名](fileId)` 一字不用改；
--   url   → id = att_url_<sha1(小写 url).slice(0,16)>
--   task  → id = att_task_<sha1(topic_key + ':' + seq).slice(0,16)>
--   ref   → id = att_ref_<sha1(ref_id).slice(0,16)>
--   dedupe_key 是「同一逻辑资源」的跨行去重键（软删后允许重新登记）。

-- @decision docs/decisions/2026-11-08-drop-task-refs.md
DROP TABLE IF EXISTS task_refs;
-- @decision docs/decisions/2026-11-08-drop-ref-relations.md
DROP TABLE IF EXISTS ref_relations;

-- @decision docs/decisions/2026-11-08-attachment-model-v2.md
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('file', 'url', 'task', 'ref')),
  name          TEXT NOT NULL DEFAULT '',
  -- 本机/云端文件本轮实际可读的绝对路径；云端缓存未下载时为空
  local_path    TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  hash          TEXT NOT NULL DEFAULT '',
  -- file 的存储位置：local=本机附件仓，cloud=云端镜像缓存
  storage       TEXT NOT NULL DEFAULT '' CHECK (storage IN ('', 'local', 'cloud')),
  group_id      INTEGER NOT NULL DEFAULT 0,
  -- 内部资源的定位信息（kind=task/ref 时有值；file/url 为空）
  target_kind   TEXT NOT NULL DEFAULT '' CHECK (target_kind IN ('', 'task', 'ref')),
  target_key    TEXT NOT NULL DEFAULT '',
  target_seq    INTEGER,
  dedupe_key    TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(meta) AND json_type(meta) = 'object'),
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 同一逻辑资源只保留一行（file 的 id 已是唯一键，dedupe_key 留空）
CREATE UNIQUE INDEX IF NOT EXISTS ux_attachments_dedupe
  ON attachments (dedupe_key)
  WHERE dedupe_key <> '' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_attachments_kind
  ON attachments (kind, deleted_at);
CREATE INDEX IF NOT EXISTS ix_attachments_target
  ON attachments (target_kind, target_key, target_seq);
CREATE INDEX IF NOT EXISTS ix_attachments_group
  ON attachments (storage, group_id, deleted_at);

-- 任务 ↔ 资源。role 是边的语义，不是资源的属性：
--   inline = 正文里直接写了（正文改了，这一行跟着改）
--   attach = 显式挂载（CLI / 面板）
--   doc    = 作为文档资料挂载（保留旧 task_refs 的 doc 语义）
-- @decision docs/decisions/2026-11-08-attachment-model-v2.md
CREATE TABLE IF NOT EXISTS task_attach (
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attachment_id TEXT    NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  role          TEXT    NOT NULL DEFAULT 'inline'
                         CHECK (role IN ('inline', 'attach', 'doc')),
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (task_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS ix_task_attach_att ON task_attach (attachment_id);

-- 文档 ↔ 资源。reference = 正文里的内部资源链接（nxkv://task|ref）。
-- @decision docs/decisions/2026-11-08-attachment-model-v2.md
CREATE TABLE IF NOT EXISTS ref_attach (
  ref_id        TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'inline'
                         CHECK (role IN ('inline', 'attach', 'reference')),
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (ref_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS ix_ref_attach_att ON ref_attach (attachment_id);
