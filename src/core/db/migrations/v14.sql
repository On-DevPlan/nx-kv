-- schema v14：task_links.type 扩 'fork'（#177 任务链四类节点可区分）
--
-- 用户场景（原文）：任务 1 上「评论两个 + fork 一个」，完成后再「反馈」——
-- 节点 1 下面应该有四个子节点：两个并行评论、一个 fork、一个反馈，类型各自可辨。
-- 旧约束只有 comment / reopen / feedback，fork 只能被记成 comment（分不清
-- 「谁只是复制了一份来另起分支」 vs 「谁是一条批注」）——链的语义丢了。
--
-- fork 的口径：从某任务**复制正文另起一条并行任务**（源任务不动、不进取代链），
-- 典型用途「这条先放一放，我另开一条独立线做」。它是四类节点之一，必须落 type。
--
-- SQLite 不能 ALTER CHECK → 12-step 重建 task_links。关系表无子引用（没有别的表
-- REFERENCES task_links），直接建新表 → 拷数据 → 换名即可。
--
-- @decision docs/decisions/versions/2026-11-22-v14.md
PRAGMA defer_foreign_keys = ON;

CREATE TABLE task_links_new (
  src_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- 派生出的新任务
  dst_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- 来源任务
  type       TEXT    NOT NULL CHECK (type IN ('comment','reopen','feedback','fork')),
  note       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id, type),
  CHECK (src_id <> dst_id)
);

INSERT INTO task_links_new (src_id, dst_id, type, note, created_at)
  SELECT src_id, dst_id, type, note, created_at FROM task_links;

-- @decision docs/decisions/versions/2026-11-22-v14.md
DROP TABLE task_links;

ALTER TABLE task_links_new RENAME TO task_links;

-- 与 v1 同口径的索引（一父约束 + 反查子任务）
CREATE UNIQUE INDEX ux_task_links_parent ON task_links (src_id);
CREATE INDEX ix_task_links_children ON task_links (dst_id);
