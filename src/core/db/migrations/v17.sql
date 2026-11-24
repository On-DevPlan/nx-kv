-- schema v17：任务归属规范成两条 topic 关联（#197 第二步）
--
-- v16 已把归属落成 tasks.repo_key + topics.group_key（组任务拆到 (cwd, group_key) 队列）。
-- v17 把它进一步规范成**两条外键**，让「组」在 topic 上真正成为可关联的对象：
--
--   · repo_topic_id   必填。仓库队列（cwd + 真实仓库）——编号序列（seq）与 get --cwd
--                     领取按它，与改造前完全一致。
--   · group_topic_id  可空。组队列（组本身也是一条 topic，key = 'group:<组key>'）——
--                     组页 `WHERE group_topic_id = ?` 一次查完；提示词模板上下文也能
--                     按它组装（组介绍 / 组内仓库），不再读正文。
--
-- v16 的 repo_key / (cwd, group_key) 队列在本步被吸收：组队列里的任务搬回同 cwd 的
-- 仓库队列（seq 冲突则重编号），组队列本身换成 'group:<组key>' 形态的组 topic。
-- 数据迁移在 v17-data.ts（同一事务）。
--
-- SQLite 不能改列名/加带外键的列 → 12-step 重建 tasks（沿用 v9 的成熟写法）。
--
-- @decision docs/decisions/versions/2026-11-24-v17.md
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE _v17_task_links AS
  SELECT src_id, dst_id, type, note, created_at FROM task_links;
CREATE TEMP TABLE _v17_task_deps AS
  SELECT task_id, dep_id, created_at FROM task_deps;
CREATE TEMP TABLE _v17_goals AS
  SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
         deleted_at, created_at, updated_at FROM goals;
CREATE TEMP TABLE _v17_task_attach AS
  SELECT task_id, attachment_id, role, position, note, created_at FROM task_attach;

-- @decision docs/decisions/versions/2026-11-24-v17.md
CREATE TABLE tasks_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  group_topic_id INTEGER          REFERENCES topics(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  type           TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','claimed','done','cancelled','plan')),
  version        INTEGER NOT NULL DEFAULT 0,
  body             TEXT    NOT NULL,
  ext              TEXT    NOT NULL DEFAULT '{}'
                   CHECK (json_valid(ext) AND json_type(ext) = 'object'),
  feedback         TEXT    NOT NULL DEFAULT '',
  feedback_at      INTEGER,
  from_src         TEXT    NOT NULL DEFAULT '',
  blocks_following INTEGER NOT NULL DEFAULT 0
                   CHECK (blocks_following IN (0,1)),
  claimed_at       INTEGER,
  done_at          INTEGER,
  round            INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (repo_topic_id, seq)
);

INSERT INTO tasks_new (
  id, repo_topic_id, group_topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
  from_src, blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at
)
SELECT
  id, topic_id, NULL, seq, type, status, version, body, ext, feedback, feedback_at,
  from_src, blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at
  FROM tasks;

-- @decision docs/decisions/versions/2026-11-24-v17.md
DROP TABLE tasks;

-- @decision docs/decisions/versions/2026-11-24-v17.md
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX ix_tasks_pending ON tasks (repo_topic_id, seq)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX ix_tasks_open ON tasks (status)
  WHERE deleted_at IS NULL;
-- 组页查询的支撑索引：一次 WHERE group_topic_id=? 取整组任务
CREATE INDEX ix_tasks_group ON tasks (group_topic_id)
  WHERE group_topic_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_tasks_identity
BEFORE UPDATE OF seq, created_at ON tasks
WHEN (OLD.repo_topic_id = NEW.repo_topic_id AND OLD.seq <> NEW.seq)
     OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, '任务身份不可修改：同队列内改号或改创建时刻（跨队列搬迁由 advanceSeq 重编号）');
END;

DELETE FROM task_links;
DELETE FROM task_deps;
DELETE FROM goals;
DELETE FROM task_attach;

INSERT OR REPLACE INTO task_links (src_id, dst_id, type, note, created_at)
SELECT src_id, dst_id, type, note, created_at FROM _v17_task_links;
INSERT OR REPLACE INTO task_deps (task_id, dep_id, created_at)
SELECT task_id, dep_id, created_at FROM _v17_task_deps;
INSERT OR REPLACE INTO goals (id, task_id, duration_sec, started_at, deadline, prompt, state, version,
                   deleted_at, created_at, updated_at)
SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
       deleted_at, created_at, updated_at FROM _v17_goals;
INSERT OR REPLACE INTO task_attach (task_id, attachment_id, role, position, note, created_at)
SELECT task_id, attachment_id, role, position, note, created_at FROM _v17_task_attach;

-- @decision docs/decisions/versions/2026-11-24-v17.md
DROP TABLE _v17_task_links;
-- @decision docs/decisions/versions/2026-11-24-v17.md
DROP TABLE _v17_task_deps;
-- @decision docs/decisions/versions/2026-11-24-v17.md
DROP TABLE _v17_goals;
-- @decision docs/decisions/versions/2026-11-24-v17.md
DROP TABLE _v17_task_attach;
