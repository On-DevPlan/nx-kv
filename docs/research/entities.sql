-- nx-kv 实体骨架（三个实体的通用字段）
--
-- 依据：docs/research/origin-intent.md —— D13 实体只有三个：
--   任务 / 仓库（含仓库组）/ 外挂 ref
--
-- 只放三张表**都有**的字段：主键、类型、状态、版本、软删除、两个时间戳。
-- 各字段的取值（type 有哪几种、state 有哪几种）逐个确认后再收紧，现在不写 CHECK。
-- 各实体的专有字段同样逐个确认后再加，一次只加一个。

-- ═══════════════════════════════════════════════════════════════════════
-- 队列（topic）：任务的分组容器
-- ═══════════════════════════════════════════════════════════════════════

-- 任务不直接挂在仓库上，而是挂在一个队列上。
-- 队列 = 「某个仓库、在本机某个目录里的那一摊活」。
--
-- 三条硬规则：
--   1. repo_key 必填 —— 队列必须落在已登记的真实仓库下，不存在游离队列
--   2. cwd 必填且唯一 —— 取任务的唯一入口就是本地目录，取任务必须带 cwd
--   3. group_key 可空 —— 空 = 这个仓库单跑，不属于任何组；
--      非空 = 程序要按该组的上下文做前置处理（注入组级提示词、查组内关联信息等）
--
-- 队列身份只有 cwd，**不带 group 维度**。原因是仓库与组本身是多对多
-- （见 repo_group_members）：一个仓库可以同时在多个组里，
-- 用单值 group_key 当身份维度根本装不下这种情形，硬把 group 塞进唯一键
-- 只会让「仓库同时在 A、B 两组」变成两条互不相干的队列、各发一套编号。
-- 所以 group_key 在这里只是「这个目录默认按哪套上下文处理」的一个标注，
-- 删组时置空即可（SET NULL），队列还在、编号不断，也不会多出一条。
CREATE TABLE topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_key      TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  cwd           TEXT    NOT NULL,                        -- 本机目录，定位入口
  group_key     TEXT             REFERENCES repos(key) ON DELETE SET NULL ON UPDATE CASCADE,
  name          TEXT    NOT NULL DEFAULT '',
  next_seq      INTEGER NOT NULL DEFAULT 1,              -- 只增不减，避免编号复用
  waiting       INTEGER NOT NULL DEFAULT 0,
  waiting_until INTEGER,                                 -- epoch ms
  state         TEXT    NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
-- 一个目录只有一条队列。COLLATE NOCASE 让 D:/Work/Web 与 D:/work/web 算同一个。
-- 不用再包 COALESCE：唯一键里没有可空列了。
CREATE UNIQUE INDEX ux_topics_cwd ON topics (cwd COLLATE NOCASE);
CREATE INDEX ix_topics_repo ON topics (repo_key);

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,                       -- 队列内编号（对外显示的 id）
  type       TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL CHECK (status IN ('pending','consumed','archived')),
  version    INTEGER NOT NULL DEFAULT 0,

  body             TEXT    NOT NULL,                  -- 原 text：markdown ≤20k，直接 TEXT

  ext              TEXT    NOT NULL DEFAULT '{}'
                   CHECK (json_valid(ext) AND json_type(ext) = 'object'),
  -- 主要内容
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (topic_id, seq)
);

-- task_relation（用户预留，待确认）

-- ═══════════════════════════════════════════════════════════════════════
-- 仓库 / 仓库组
-- ═══════════════════════════════════════════════════════════════════════

-- key 就是身份，所以它直接做主键，不再另设随机 id。
--
-- 为什么不能是路径或随机 id：整个关系（绑定哪些 ref、属于哪个组）要能导出，
-- 换一台机器后原样重建。路径换机器就失效，随机 id 换机器就重排，两者都导不出关系。
-- 只有规范化的 key 是「同一台机器之外也成立」的事实。
--
-- key 的取值规则（写入层保证）：
--   1. 开发仓库优先由远程地址归一化：协议头去掉、.git 去掉、转小写、去尾部斜杠
--      → github.com/org/repo
--   2. 没有远程地址时，必须由用户显式给出，**不允许**自动生成 local/<目录名>
--      （那是拿目录当身份，换机器就撞车，正是要避免的东西）
--   3. 仓库组由用户命名，与仓库共用同一个命名空间
--
-- type：repo = 开发仓库，group = 仓库组。组是仓库的集合，不是另一种实体。
--
-- key 与 path 的关系（这是本表最容易被误读的地方）：
--   key   跨机器成立，是仓库的身份，导出时带上
--   path  只在本机成立，是「这个仓库在这台机器上落在哪个目录」，导出时丢弃
--   所以同一套关系导到另一台机器后，key 全部对得上，path 由那台机器重新绑。
--   二者不是一回事：key 换成目录就导不出去，path 换成 key 就跨不了机器。
--
-- 组包含哪些仓库不在这张表里 —— 见下面的 repo_group_members。
CREATE TABLE repos (
  key          TEXT    PRIMARY KEY,          -- 全局唯一身份，导出关系靠它
  type         TEXT    NOT NULL DEFAULT '',  -- repo / group
  name         TEXT    NOT NULL DEFAULT '',  -- 显示名，可重复、可改
  description  TEXT    NOT NULL DEFAULT '',  -- 一句话摘要
  path         TEXT    NOT NULL DEFAULT '',  -- 本机路径（仅 repo；不参与导出）
  remote       TEXT    NOT NULL DEFAULT '',  -- 远程地址（仅 repo；key 的归一化来源）
  sort_order   INTEGER NOT NULL DEFAULT 0,
  state        TEXT    NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  CHECK (key <> '')                                   -- 空 key 直接拒
);

-- ═══════════════════════════════════════════════════════════════════════
-- 仓库组的成员：组包含仓库
-- ═══════════════════════════════════════════════════════════════════════

-- 多对多：一个组含多个仓库，一个仓库也可同时属于多个组。
-- 两端都是 repos.key，其中 group_key 那一侧必须是 type='group'。
-- 这条约束跨表（要查 repos.type），CHECK 表达不了，由写入层保证，必要时补触发器。
CREATE TABLE repo_group_members (
  group_key  TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  repo_key   TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,   -- 组内排序
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_key, repo_key),
  CHECK (group_key <> repo_key)            -- 组不能包含自己
);
CREATE INDEX ix_members_repo ON repo_group_members (repo_key);  -- 反查：这个仓库被哪些组包含

CREATE TABLE refs (
  id         TEXT PRIMARY KEY,
  type       TEXT    NOT NULL DEFAULT '',   -- file / url / path / ...
  locator    TEXT    NOT NULL DEFAULT '',   -- 内容在哪：文件标识 / URL / 文件路径
  state      TEXT    NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════
-- ref 的绑定：一张表装三种宿主，列表式多对多
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 某个列表里的一项。没有「主引用」这种单值字段：
-- 列表首项就是 position 最小的那一项。
--
-- 宿主用 key 而不是 id 引用：换机器重建关系时，key 是唯一还能对上的东西。
-- ON UPDATE CASCADE：key 被改名时，绑定跟着走，不会留下孤儿行。
--
-- type 说明这一行挂在谁身上：
--   repo        仓库自己的描述列表          group_key 为空
--   group       仓库组自己的描述列表        group_key 为空
--   group_repo  仓库在某个组里的单独列表    group_key 必须给出
CREATE TABLE ref_bindings (
  repo_key   TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  group_key  TEXT             REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  ref_id     TEXT    NOT NULL REFERENCES refs(id)  ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('repo','group','group_repo')),
  position   INTEGER NOT NULL DEFAULT 0,   -- 列表顺序，0 = 首项
  note       TEXT    NOT NULL DEFAULT '',  -- 这一项在列表里的说明
  created_at INTEGER NOT NULL,
  CHECK (
    (type =  'group_repo' AND group_key IS NOT NULL)
    OR (type <> 'group_repo' AND group_key IS NULL)
  )
);

-- 同一宿主同一 ref 只出现一次。group_key 可空，必须 COALESCE 才能做唯一性：
-- SQLite 里 NULL 在唯一索引中互不相等，不包一层等于没约束。
CREATE UNIQUE INDEX ux_ref_bindings
  ON ref_bindings (repo_key, COALESCE(group_key,''), ref_id);
CREATE INDEX ix_ref_bindings_list
  ON ref_bindings (repo_key, COALESCE(group_key,''), position);
CREATE INDEX ix_ref_bindings_ref ON ref_bindings (ref_id);
