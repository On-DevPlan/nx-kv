-- schema v11：孤儿文档的失绑计时与到期清理留痕
--
-- 口径（2026-11-15 用户拍板）：ref 没有任何 ref_bindings 归属即为孤儿；
-- 失绑起算时间落 refs.orphan_since（0 = 未计时 / 仍有归属）。
-- 到期清理**只软删** refs 行（deleted_at），不碰 ref_bodies；
-- 每次清理在 ref_gc_log 留一条不可变记录（删除前清单、删除后审计都读它）。
--
-- @decision docs/decisions/2026-11-15-orphan-ref-gc.md
ALTER TABLE refs ADD COLUMN orphan_since INTEGER NOT NULL DEFAULT 0;

-- @decision docs/decisions/2026-11-15-orphan-ref-gc.md
CREATE TABLE ref_gc_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_id      TEXT    NOT NULL,
  ref_desc    TEXT    NOT NULL DEFAULT '',
  origin      TEXT    NOT NULL DEFAULT '',
  body_bytes  INTEGER NOT NULL DEFAULT 0,
  unbound_at  INTEGER NOT NULL,
  deleted_at  INTEGER NOT NULL,
  ttl_days    INTEGER NOT NULL,
  reason      TEXT    NOT NULL DEFAULT '',
  source      TEXT    NOT NULL DEFAULT '',
  snapshot    TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE INDEX ix_ref_gc_log_ref ON ref_gc_log (ref_id);
CREATE INDEX ix_ref_gc_log_deleted ON ref_gc_log (deleted_at);
