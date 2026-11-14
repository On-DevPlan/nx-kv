-- schema v9：任务新增 plan（临时草稿）状态
--
-- 口径（#126）：plan 是**不进队列的临时态**——头脑风暴时想把想法记成任务，
-- 但不想被 `localtask get` / wait / 主题队列领走，也不参与闸门与依赖推进。
-- 它必须是一个真正的 status 值（不是 ext 里的一面旗）：全链路的待领取判据
-- 都是 `status === 'pending'` 的**正判定**，新状态天然被所有取任务路径排除，
-- 不用逐条 SQL 补条件。
--
-- SQLite 不能 ALTER 既有 CHECK → 12-step 重建 tasks（沿用 v5 的成熟写法）。
-- DROP TABLE 会级联删子表行（`defer_foreign_keys` 只推迟校验、不推迟级联动作），
-- 所以所有 REFERENCES tasks(id) 的关系表先快照、重建后按显式列名回填。
--
-- @decision docs/decisions/2026-11-14-plan-status.md
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE _v9_task_links AS
  SELECT src_id, dst_id, type, note, created_at FROM task_links;
CREATE TEMP TABLE _v9_task_deps AS
  SELECT task_id, dep_id, created_at FROM task_deps;
CREATE TEMP TABLE _v9_goals AS
  SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
         deleted_at, created_at, updated_at FROM goals;
CREATE TEMP TABLE _v9_task_attach AS
  SELECT task_id, attachment_id, role, position, note, created_at FROM task_attach;

-- @decision docs/decisions/2026-11-14-plan-status.md
CREATE TABLE tasks_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','claimed','done','cancelled','plan')),
  version    INTEGER NOT NULL DEFAULT 0,

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
  UNIQUE (topic_id, seq)
);

INSERT INTO tasks_new (
  id, topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
  from_src, blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at
)
SELECT
  id, topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
  from_src, blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at
  FROM tasks;

-- @decision docs/decisions/2026-11-14-plan-status.md
DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX ix_tasks_pending ON tasks (topic_id, seq)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX ix_tasks_open ON tasks (status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_tasks_identity
BEFORE UPDATE OF seq, created_at ON tasks
WHEN (OLD.topic_id = NEW.topic_id AND OLD.seq <> NEW.seq)
     OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, '任务身份不可修改：同队列内改号或改创建时刻（跨队列搬迁由 advanceSeq 重编号）');
END;

-- DROP TABLE 是否级联取决于连接上的 foreign_keys：先清空再回填，两种情形都不重不漏
DELETE FROM task_links;
DELETE FROM task_deps;
DELETE FROM goals;
DELETE FROM task_attach;

INSERT OR REPLACE INTO task_links (src_id, dst_id, type, note, created_at)
SELECT src_id, dst_id, type, note, created_at FROM _v9_task_links;
INSERT OR REPLACE INTO task_deps (task_id, dep_id, created_at)
SELECT task_id, dep_id, created_at FROM _v9_task_deps;
INSERT OR REPLACE INTO goals (id, task_id, duration_sec, started_at, deadline, prompt, state, version,
                   deleted_at, created_at, updated_at)
SELECT id, task_id, duration_sec, started_at, deadline, prompt, state, version,
       deleted_at, created_at, updated_at FROM _v9_goals;
INSERT OR REPLACE INTO task_attach (task_id, attachment_id, role, position, note, created_at)
SELECT task_id, attachment_id, role, position, note, created_at FROM _v9_task_attach;

-- @decision docs/decisions/2026-11-14-plan-status.md
DROP TABLE _v9_task_links;
-- @decision docs/decisions/2026-11-14-plan-status.md
DROP TABLE _v9_task_deps;
-- @decision docs/decisions/2026-11-14-plan-status.md
DROP TABLE _v9_goals;
-- @decision docs/decisions/2026-11-14-plan-status.md
DROP TABLE _v9_task_attach;
