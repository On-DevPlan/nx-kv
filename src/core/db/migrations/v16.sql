-- schema v16：任务归属落库——task 直接挂「仓库队列」与「组队列」两条 topic 关系（#197）
--
-- 背景：任务"属于哪个组 / 哪个仓库"一直写在正文头部的 frontmatter 里
--   ---
--   board: b_mw...        -- 组 id
--   project: local/nx-kv  -- 归属仓库 key
--   ---
-- 前端 / CLI 各自解析这段文本认亲，组页任务列表靠「全量拉 task + 逐条 parseFrontmatter
-- + 字符串比对」筛出来。没有索引、没有外键，改正文就能改归属。
--
-- v16 把归属变成**库内关系**，tasks 直接持两个 topic 外键：
--   · repo_topic_id   必填。仓库队列（cwd + 真实仓库）——任务的编号序列（seq）按它分配，
--                     `get --cwd` 领取也按它找队列，与改造前一致。
--   · group_topic_id  可空。组队列（组 = 一个 topic，key = 'group:<组key>'）——
--                     组页查询 `WHERE group_topic_id = ?` 一次查完；提示词模板上下文
--                     也能按这条关联直接组装（组介绍 / 组内仓库），不用再读正文。
-- 两者都是 topics 行：repo topic 由 (cwd, '') 派生、group topic 由组的 key 派生。
--
-- 正文只留 markdown 本身（标题 + 内容），不再有 --- 头。
--
-- SQLite 不能 ALTER 列名/加带外键的列 → 12-step 重建 tasks（沿用 v9 的成熟写法）。
-- DROP TABLE 会级联删 REFERENCES tasks(id) 的子表行，所以先快照、重建后按显式列名回填。
--
-- @decision docs/decisions/versions/2026-11-24-v16.md
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE _v16_task_links AS
  SELECT src_id, dst_id, type, note, created_at FROM task_links;
CREATE TEMP TABLE _v16_task_deps AS
  SELECT task_id, dep_id, created_at FROM task_deps;
CREATE TEMP TABLE _v16_goals AS
  SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
         deleted_at, created_at, updated_at FROM goals;
CREATE TEMP TABLE _v16_task_attach AS
  SELECT task_id, attachment_id, role, position, note, created_at FROM task_attach;

-- @decision docs/decisions/versions/2026-11-24-v16.md
CREATE TABLE tasks_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 仓库队列（必填）：编号序列、领取寻址都按它
  repo_topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  -- 组队列（可空）：组归属的唯一来源；空 = 纯仓库任务
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

-- @decision docs/decisions/versions/2026-11-24-v16.md
DROP TABLE tasks;

-- @decision docs/decisions/versions/2026-11-24-v16.md
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

-- 先清空再回填：DROP TABLE 是否级联取决于连接上的 foreign_keys，两种情形都不重不漏
DELETE FROM task_links;
DELETE FROM task_deps;
DELETE FROM goals;
DELETE FROM task_attach;

INSERT OR REPLACE INTO task_links (src_id, dst_id, type, note, created_at)
SELECT src_id, dst_id, type, note, created_at FROM _v16_task_links;
INSERT OR REPLACE INTO task_deps (task_id, dep_id, created_at)
SELECT task_id, dep_id, created_at FROM _v16_task_deps;
INSERT OR REPLACE INTO goals (id, task_id, duration_sec, started_at, deadline, prompt, state, version,
                   deleted_at, created_at, updated_at)
SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
       deleted_at, created_at, updated_at FROM _v16_goals;
INSERT OR REPLACE INTO task_attach (task_id, attachment_id, role, position, note, created_at)
SELECT task_id, attachment_id, role, position, note, created_at FROM _v16_task_attach;

-- @decision docs/decisions/versions/2026-11-24-v16.md
DROP TABLE _v16_task_links;
-- @decision docs/decisions/versions/2026-11-24-v16.md
DROP TABLE _v16_task_deps;
-- @decision docs/decisions/versions/2026-11-24-v16.md
DROP TABLE _v16_goals;
-- @decision docs/decisions/versions/2026-11-24-v16.md
DROP TABLE _v16_task_attach;
