-- schema v6：refs 从「文档索引」升级为「文档本体」
--
-- 设计口径（2026-11-12 二轮确认，docs/decisions/2026-11-12-refs-body-in-db.md §11）：
--   · 正文进 ref_bodies（1:1 挂 refs.id），refs 只留身份与元数据；
--   · refs 新增 rel（逻辑名，唯一）/ origin / body_bytes；locator 冻结为历史取证列；
--   · ref_attach 的 role 增 'source'：这条 ref 的正文来自某个 mdfile 附件；
--   · 存量 133 行 id 全部保留（方案 A：ref_<sha1(rel)> 只用于新行）。
--
-- refs 用 ALTER 加列、不重建：重建父表会在 DROP 时立刻触发子表
-- ref_bindings / ref_attach 的 ON DELETE CASCADE（v5 已实测）。
--
-- ref_attach 的 CHECK 必须重建表（SQLite 不能 ALTER CHECK）。它没有子表，
-- 但按同一口径先快照、重建后回填，避免 DROP 期间的外键动作留下空洞。
--
-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
PRAGMA defer_foreign_keys = ON;

-- ── refs：身份 + 元数据（正文在 ref_bodies） ────────────────────────────
ALTER TABLE refs ADD COLUMN rel TEXT NOT NULL DEFAULT '';
ALTER TABLE refs ADD COLUMN origin TEXT NOT NULL DEFAULT 'own';   -- own | import | external
ALTER TABLE refs ADD COLUMN body_bytes INTEGER NOT NULL DEFAULT 0;

-- rel 是逻辑名，不是路径；空串表示尚未归位（迁移后活动行不再有）
CREATE UNIQUE INDEX IF NOT EXISTS ux_refs_rel
  ON refs (rel)
  WHERE rel <> '' AND deleted_at IS NULL;

-- ── ref_bodies：正文唯一真相 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ref_bodies (
  ref_id     TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  body_bytes INTEGER NOT NULL CHECK (body_bytes >= 0),
  body_hash  TEXT    NOT NULL DEFAULT '',   -- sha256(body)，导入去重与漂移检测
  updated_at INTEGER NOT NULL
);

-- ── ref_attach：role CHECK 增 'source'（关系表快照 → 重建 → 回填） ──────
CREATE TEMP TABLE _v6_ref_attach AS
  SELECT ref_id, attachment_id, role, position, note, created_at FROM ref_attach;

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
CREATE TABLE ref_attach_new (
  ref_id        TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'inline'
                CHECK (role IN ('inline', 'attach', 'reference', 'source')),
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (ref_id, attachment_id)
);

INSERT INTO ref_attach_new (ref_id, attachment_id, role, position, note, created_at)
SELECT ref_id, attachment_id, role, position, note, created_at FROM _v6_ref_attach;

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
-- 删除决策：ref_attach 的 role CHECK 需要扩 'source'，SQLite 无法 ALTER CHECK，
-- 只能按快照重建；旧表在回填完成后立即删除，索引随后重建。
DROP TABLE ref_attach;
ALTER TABLE ref_attach_new RENAME TO ref_attach;

-- v2 的索引原样重建（DROP TABLE 时随表消失）
CREATE INDEX IF NOT EXISTS ix_ref_attach_att ON ref_attach (attachment_id);

-- @decision docs/decisions/2026-11-12-refs-body-in-db.md
-- 删除决策：TEMP 快照只服务本次重建，回填完成即删（随连接生命周期回收）。
DROP TABLE _v6_ref_attach;
