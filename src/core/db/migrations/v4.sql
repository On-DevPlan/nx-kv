-- schema v4：参考仓库绑定从「仓库级」迁到「组级」
--
-- 口径（2026-11-09）：参考仓库（type=ref）直接绑定到**组（type=group）**上，
-- 组内所有仓库共享，**没有继承/覆盖/排除**语义；也不再有「仓库自己的参考仓库」。
-- 一个组 ↔ 多个参考仓库、一个参考仓库 ↔ 多个组（多对多）。
--
-- 旧数据在 repos.ext.ext_linked（ref 侧 kind='repo'|'board'、dev 侧 kind='ref'），
-- v4-data.js 负责搬到这张表并清掉已迁移的 ext 条目；无归属组的仓库的绑定
-- **保留在 ext 里不搬**（不静默丢弃，checkRefs 会报「未迁移」）。
--
-- group_key / ref_key 两端都是 repos.key：组删除 / 改名走 ON DELETE CASCADE /
-- ON UPDATE CASCADE；ref 被删除同理。写入层额外保证 group_key 是 type='group'、
-- ref_key 是 type='ref'（跨表约束，CHECK 表达不了）。
-- @decision docs/decisions/2026-11-09-group-level-refs.md
CREATE TABLE group_refs (
  group_key  TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  ref_key    TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 这条参考在本组里「参考什么」；与 repo_group_members.note 同一哲学：
  -- 描述挂在关系上，不是挂在参考仓库本身上。
  note       TEXT    NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_key, ref_key),
  CHECK (group_key <> ref_key)
);
CREATE INDEX ix_group_refs_ref ON group_refs (ref_key);  -- 反查：这个参考被哪些组共享
