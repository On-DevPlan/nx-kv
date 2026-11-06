-- nx-kv 实体骨架（三个实体的通用字段）
--
-- 依据：docs/research/origin-intent.md —— D13 实体只有三个：
--   任务 / 仓库（含仓库组）/ 外挂 ref
--
-- 只放三张表**都有**的字段：主键、类型、状态、版本、软删除、两个时间戳。
-- 各字段的取值（type 有哪几种、state 有哪几种）逐个确认后再收紧，现在不写 CHECK。
-- 各实体的专有字段同样逐个确认后再加，一次只加一个。

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL CHECK (status IN ('pending','consumed','archived')),
  version    INTEGER NOT NULL DEFAULT 0,

  body             TEXT    NOT NULL,                  -- 原 text：markdown ≤20k，直接 TEXT

    ext              TEXT    NOT NULL DEFAULT '{}'
                   CHECK (json_valid(ext) AND json_type(ext) = 'object'),
  # 主要内容的包含 
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

# task_relation  用户

CREATE TABLE repos (
  id         TEXT PRIMARY KEY,
  type       TEXT    NOT NULL DEFAULT '',
  state      TEXT    NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE refs (
  id         TEXT PRIMARY KEY,
  type       TEXT    NOT NULL DEFAULT '',
  state      TEXT    NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
