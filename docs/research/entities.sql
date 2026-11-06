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
-- 队列 = 「某个仓库 + 某个组上下文 + 本机某个目录」下的那一摊活。
--
-- 三条硬规则：
--   1. repo_key 必填 —— 队列必须落在已登记的真实仓库下，不存在游离队列
--   2. cwd 必填 —— 取任务的唯一入口就是本地目录，取任务必须带 cwd
--   3. group_key 可空 —— 空 = 这个目录单跑这个 repo，不带组上下文；
--      非空 = 按该组的上下文做前置处理（注入组级提示词、查组内关联信息等）
--
-- 队列身份 = **(cwd, group)**，不是 cwd 一个。同一个目录可以在多个组下各跑一摊活：
--   D:/work/web + 前端组    → 一条队列
--   D:/work/web + 基础设施组 → 另一条队列
--   D:/work/web + 无组       → 再一条队列（单跑这个 repo）
-- 三条互不相干，各自发自己的编号（next_seq）、各自的等待状态。
--
-- 这和 repo_group_members 不冲突，两层语义不同：
--   repo_group_members  = 这个仓库**可能**属于哪些组（成员关系，多对多）
--   topics.group_key    = 这个目录**当下真的**按哪套上下文在跑（实例，每条一份编号）
-- 所以「repo + repo_group 合起来是个 key」在队列这一层就体现为 (cwd, group) 唯一。
--
-- 删组用 RESTRICT 而不是 SET NULL：置空会让那条队列和「本目录单跑 repo」那条撞成
-- 同一个 (cwd, NULL)，删不删得成功取决于该目录下有没有单跑队列 —— 这种时灵时不灵的
-- 行为比直接报错糟糕得多。所以要求先把挂在组上下文下的队列处理掉，再删组。
CREATE TABLE topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_key      TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  cwd           TEXT    NOT NULL,                        -- 本机目录，定位入口
  group_key     TEXT             REFERENCES repos(key) ON DELETE RESTRICT ON UPDATE CASCADE,
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
-- (cwd, group) 唯一。COLLATE NOCASE 让 D:/Work/Web 与 D:/work/web 算同一个目录。
-- group_key 可空，必须 COALESCE 才能做唯一性：SQLite 里 NULL 在唯一索引中互不相等，
-- 不包一层的话「单跑队列」可以重复插无数次，约束等于没写。
CREATE UNIQUE INDEX ux_topics_cwd_group
  ON topics (cwd COLLATE NOCASE, COALESCE(group_key,''));
CREATE INDEX ix_topics_repo ON topics (repo_key);

-- 正文**可改**：任务是「这一轮的工作单」，边上边补命令、贴日志、改措辞都是正常的。
-- 不可改的是**身份**（队列内编号 + 创建时刻），以及「编辑不能让它重新进状态机」。
--   改需求/返工 → 派生新任务，不是回写这一条；
--   同一轮里修正文 → 随便改，status 不动。
-- 这条界线只能靠流程守：库里「改需求」和「补个错字」都是同一条 UPDATE，SQL 分不出来。
-- 状态只描述它自己走到了哪一步，不描述内容：
--   pending    待领取
--   claimed    已被 agent 领走（在干）
--   done       已交付（feedback 在这一刻写入）
--   cancelled  作废（不再干这条，但要留着说"当年为什么要干这个"）
CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,                       -- 队列内编号（对外显示的 id）
  type       TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','claimed','done','cancelled')),
  version    INTEGER NOT NULL DEFAULT 0,

  body             TEXT    NOT NULL,                  -- 原 text：markdown ≤20k，直接 TEXT

  ext              TEXT    NOT NULL DEFAULT '{}'
                   CHECK (json_valid(ext) AND json_type(ext) = 'object'),

  -- 完成回调：任务交付后由 AI 回调写入的反馈/评价。
  -- 在「任务不可变」的模型下它只写一次，写完这条任务就定格；
  -- 需要因为反馈再干一轮 → 不在这里改，派生一条新任务（见 task_links）。
  feedback         TEXT    NOT NULL DEFAULT '',
  feedback_at      INTEGER,                          -- 反馈写入时刻，未回调则为空

  -- 状态时间戳：没有它们就没法回答「什么时候领的 / 多久交付的」，
  -- 而 updated_at 会被任意写入刷新，当不了完成时刻用。
  claimed_at       INTEGER,
  done_at          INTEGER,

  -- 链上的第几轮：根任务 = 1，派生任务 = 来源任务的 round + 1。
  -- 存下来是为了列表/看板能直接显示「第 3 轮」，不必每条都递归回溯。
  -- （common 里的 version 是行级乐观锁计数，和这个不是一回事，别混。）
  round            INTEGER NOT NULL DEFAULT 1,

  -- 主要内容
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (topic_id, seq)
);

-- 只锁身份，不锁正文。
-- 锁两样：队列内编号、创建时刻 —— 这两样一变，「这个 id 当初指的是哪一条」就没了。
-- 正文、status、feedback、claimed_at/done_at、ext、version、topic_id（搬队列）都可以改。
CREATE TRIGGER trg_tasks_identity
BEFORE UPDATE OF seq, created_at ON tasks
WHEN OLD.seq <> NEW.seq OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, '任务身份不可修改：编号与创建时刻是 (topic, seq) 的一部分');
END;

-- ═══════════════════════════════════════════════════════════════════════
-- task ↔ task：派生链（append-only 历史）
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 「src 这条任务是从 dst 那条派生出来的，因为 type」。
-- 方向恒为 新 → 旧，不存反向边：反向（谁从我这儿派生）靠 dst 上的索引查。
--
-- 为什么是表而不是 tasks 上的一个 parent_id 列：
--   派生动因有几种（评论 / 重开 / 反馈），都要记；而且「整条链」要能一次递归查出来。
--   但「一个任务只有一个来源」这条仍然强制 —— 靠下面的 partial unique index，
--   不靠列的唯一性。这样既保持了树形，又不把动因压成一个不明所以的字符串。
--
-- 不可变语义（这是和旧实现的根本差别）：
--   旧版 reopen 是**就地改同一条**：status 回 pending、reopenCount+1、history 追加节点。
--   新版不这么干：旧任务定格，派生一条新任务，两者用边连起来。
--   于是 id 永远指向当初那条内容，编号不会被复用，历史也不会被后续轮次覆盖。
--
-- 因此也不再有 history[] 这张/这列：旧 history 里的 origin / reopen / comment 节点，
-- 本质是「同一行被改过好几次的快照」。既然每次都要派生新任务，快照就没有存在意义 ——
-- 每轮本身就是一条独立任务，正文各存各的，不存在"覆盖"。
--
-- type：
--   comment    由某条评论派生（评论区划选 → 新任务）
--   reopen     重开：上一轮没通过，另起一条接着做
--   feedback   完成回调的反馈里提出了新活，派生一条新任务
CREATE TABLE task_links (
  src_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- 派生出的新任务
  dst_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- 来源任务
  type       TEXT    NOT NULL CHECK (type IN ('comment','reopen','feedback')),
  note       TEXT    NOT NULL DEFAULT '',   -- 派生时的一句话（评论原文 / 反馈摘要）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id, type),
  CHECK (src_id <> dst_id)                  -- 不能从自己派生
);

-- 一个任务只有一个来源 = 链是树不是网。三种 type 互斥，所以约束不分 type。
CREATE UNIQUE INDEX ux_task_links_parent ON task_links (src_id);
-- 反查：这条任务派生出了哪些（子任务 / 整条链往下一代走）
CREATE INDEX ix_task_links_children ON task_links (dst_id);

-- 「整条创建链」不需要单独的表或列，递归查即可（从某条往上追到根）：
--   WITH RECURSIVE up(id, type, depth) AS (
--     SELECT dst_id, type, 1 FROM task_links WHERE src_id = ?
--     UNION ALL
--     SELECT l.dst_id, l.type, up.depth + 1
--       FROM task_links l JOIN up ON l.src_id = up.id
--   ) SELECT up.*, t.seq FROM up JOIN tasks t ON t.id = up.id ORDER BY up.depth;
--
-- 依附的是全局 tasks.id，不是 (topic, seq)：所以任务被搬到别的队列后链不会断。
-- （旧实现存的是 "topicKey:id" 字符串，搬队列就得重写字符串，漏一处就成虚链。）

-- ═══════════════════════════════════════════════════════════════════════
-- task ↔ task：编排依赖（可变约束，和上面的历史分开）
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 「task 要等 dep 完成才能领」。多对多：一条任务可以等好几条，
-- 一条任务也可以挡住好几条。取代旧 blockBy 里的 "topicKey:id" 字符串数组。
--
-- 为什么和 task_links 分成两张表，而不是一张表加 type：
--   两者的生命周期正好相反。
--     派生链  = 发生过的事实，append-only，永不改、永不删（除级联清库）；
--     依赖    = 当下的约束，会加会撤（改顺序、依赖已完成、任务被重排）。
--   混成一张表后，「删掉一条依赖」和「删掉一段历史」就是同一种 DELETE，
--   一次手滑就把链删了，而链是后来追溯「这活怎么变成现在这样」的唯一依据。
CREATE TABLE task_deps (
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, dep_id),
  CHECK (task_id <> dep_id)                 -- 不能依赖自己
);
CREATE INDEX ix_task_deps_dep ON task_deps (dep_id);   -- 反查：这条挡住谁

-- ═══════════════════════════════════════════════════════════════════════
-- 时间目标（timegoal）：挂在**任务**上，不挂在队列上
-- ═══════════════════════════════════════════════════════════════════════

-- 旧实现放 timegoals.json，键是字符串 `"<topicKey>"` 或 `"task:<topicKey>:<id>"`，
-- 一个字典要同时装「队列级目标」和「任务级目标」两种东西。
-- 现在只保留后者：目标是「这条活要在多久内交」，主体是任务。
-- 队列级没有意义 —— 队列是容器，没有交付这件事。
--
-- 所以 task_id 是必填外键，"作用域字符串"这套东西整体消失。
--
-- 一个任务一个目标（UNIQUE task_id）：任务不可变，一轮一个截止时刻。
-- 要加时间，是改 duration/deadline；要重做，是派生新任务、新任务自己的目标。
-- 将来真需要「一个任务挂多个目标」（比如软截止 + 硬截止），把唯一索引去掉即可，
-- 不影响已有数据。
CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  duration_sec  INTEGER NOT NULL,                    -- 时长（秒），发布时给的
  started_at    INTEGER NOT NULL,                    -- 起表时刻（= 任务领取时刻）
  deadline      INTEGER NOT NULL,                    -- started_at + duration_sec*1000
  prompt        TEXT    NOT NULL DEFAULT '',         -- 发布方附加要求，交付文本里会带
  state         TEXT    NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  CHECK (duration_sec > 0),
  CHECK (deadline > started_at)                      -- 负时长/倒挂直接拒
);
CREATE UNIQUE INDEX ux_goals_task ON goals (task_id);
CREATE INDEX ix_goals_deadline ON goals (deadline) WHERE deleted_at IS NULL;  -- 到点扫描

-- ═══════════════════════════════════════════════════════════════════════
-- 每次 check 的流水：把当时的 summary 一起记下来
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 一次 check。agent 每轮汇报 summary 时同时算一次剩余时间，
-- 两者落在一行里 —— 这样事后能回答「他说到哪了的时候，还剩多少时间」，
-- 而不只是「他什么时候 check 过」。
--
-- 为什么把 elapsed/remaining/overtime 三个派生值也存下来，而不是用时再算：
-- deadline 是会被改的（加时间）。不存当日快照的话，一旦延期，
-- 所有历史 check 的"当时还剩多久"都会被重算成另一个数 —— 历史被改写。
-- 这三个值只增不改，是那一次 check 的事实。
--
-- 为什么不再有 logTruncated（旧 store 里有）：
-- 那是 JSON 文件时代的产物 —— 每次写都要重写整份文件，日志必须截断。
-- 行级追加没有这个约束，总量用 count(*) 就有，不需要"是否截断过"这个标记。
-- 真要控体积，按时间删旧行即可，那是运维动作，不是 schema 概念。
CREATE TABLE goal_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id       INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,                    -- epoch ms
  elapsed_sec   INTEGER NOT NULL,                    -- 已过（as-of 当时）
  remaining_sec INTEGER NOT NULL,                    -- 还剩，到点后为 0
  overtime_sec  INTEGER NOT NULL DEFAULT 0,          -- 超时多久
  reached       INTEGER NOT NULL DEFAULT 0
                CHECK (reached IN (0,1)),            -- 这一刻是否已到点
  summary       TEXT    NOT NULL DEFAULT ''          -- 这一轮汇报的现状
);
CREATE INDEX ix_goal_checks_goal ON goal_checks (goal_id, at DESC);  -- 取最近一次 check

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

-- ref = 一切「有身份、能被多处引用、内容本身在库外」的东西：md / 目录 / 图片 / 附件 / url。
--
-- locator 存的是**稳定标识**，不是绝对路径：
--   md / dir   → 文档地址 = docs 根下的相对路径，第一段是命名空间（见下节）
--                例：repo/github.com/acme/web/docs/api.md
--   image/file → 云端 fileId（本地路径由 attachmentsDir + manifest 运行时算出来）
--   url        → 完整链接
-- 为什么不存绝对路径：attachmentsDir / NX_KV_ATTACHMENTS / 换台机器，任一变就全错，
-- 而且是静默错 —— 路径还在、文件不在，读出来是空而不是报错。
--
-- locator 同时也是**双链里的地址**，两者是同一个字符串，不存在「逻辑地址 / 物理路径」
-- 两套需要对账的东西。这是下面那套解析规则能成立的前提。
CREATE TABLE refs (
  id         TEXT PRIMARY KEY,
  type       TEXT    NOT NULL DEFAULT '',   -- md / dir / image / file / path / url
  locator    TEXT    NOT NULL DEFAULT '',   -- 稳定标识：fileId / 相对路径 / URL
  state      TEXT    NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 快搜靠这个索引：前缀匹配用范围比较（>= q AND < q||上界）才走索引，
-- LIKE 'x%' 在 SQLite 里是 SCAN，不走。详见下面「快搜」那段。
CREATE INDEX ix_refs_locator ON refs (locator COLLATE NOCASE);

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

-- ═══════════════════════════════════════════════════════════════════════
-- task ↔ ref：任务正文/附件里引用的东西
-- ═══════════════════════════════════════════════════════════════════════

-- 为什么这张表必须有，而不是「正文里写了 fileId，渲染时现解析」：
--   1. 删任务时要知道清哪些字节。只认正文的话，任务删了，本地镜像还躺着，没人收尸；
--   2. 删/换附件时要知道「还有谁在用」。否则只能全表扫 body 做正则，任务一多就废；
--   3. 面板要列出「这条任务的附件」，扫正文等于每次都重新解析一遍 markdown。
--
-- 位置关系（重要）：
--   refs          真相 —— 这个东西是什么、字节在哪（locator）
--   task_refs     引用关系 —— 这条任务用了它
--   正文里的 ![](fid)  渲染线索 —— 给人和 agent 看的位置，不是真相
-- 三者不重复：正文是给人读的，表是给程序查的。改正文时同步一次绑定即可。
--
-- role：
--   inline  正文 markdown 里内嵌（图片、下载链接）
--   attach  附件区挂着的（没写进正文，但归属于这条任务）
--   doc     挂载的 md 文档（任务说明、规格书等，点开可看全文）
CREATE TABLE task_refs (
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ref_id     TEXT    NOT NULL REFERENCES refs(id)  ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'inline'
             CHECK (role IN ('inline','attach','doc')),
  position   INTEGER NOT NULL DEFAULT 0,   -- 同一 role 内的展示顺序（inline 的可留 0，顺序由正文决定）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, ref_id)
);
CREATE INDEX ix_task_refs_ref ON task_refs (ref_id);   -- 反查：这个文件被哪些任务用着

-- ═══════════════════════════════════════════════════════════════════════
-- 文档地址与命名空间
-- ═══════════════════════════════════════════════════════════════════════
--
-- 一句话：**地址就是文件在 docs 根下的相对路径，第一段是命名空间。**
-- 不另造 URI 前缀，也不再存一份「逻辑地址」——物理位置和逻辑地址是同一个字符串，
-- 所以不会出现「两套地址互相对不上」这种问题。
--
--   ~/.nx-kv/docs/
--     repo/<repoKey>/...     仓库自己的文档树       地址 = repo/github.com/acme/web/docs/api.md
--     group/<groupKey>/...   仓库组自己的文档树     地址 = group/frontend/spec.md
--     ext/<绝对路径>         外部绑定（Obsidian 等） 地址 = ext/D:/vault/notes/a.md
--
-- 只设三个根，是因为只有三种**内容归属**。任务不在里面：task 不是 ref，正文是 tasks.body
-- 这一列，它没有地址、不能被双链指向。任务要用文档就挂载（task_refs.role='doc'），
-- 方向和文档链文档正好相反。
--
-- 为什么 repo 在组内的单独文档不单独开根：
--   它在磁盘上本来就住在那个仓库的树里（repo/<key>/...），「属于哪个组的上下文」
--   是绑定信息（ref_bindings.group_key），不是位置。位置只回答"文件在哪"，
--   绑定回答"在什么场合用它"。两者混在一起，同一个文件就会有两个地址。
--
-- ── 双链语法（Obsidian 兼容 + 显式地址） ────────────────────────────────
--   [[repo/github.com/acme/web/docs/api.md]]          绝对地址
--   [[repo/github.com/acme/web/docs/api.md|接口文档]]  带显示名
--   [[repo/github.com/acme/web/docs/api.md#错误码]]    带锚点（锚点不进地址，单独存）
--   [[./sibling.md]] / [[../spec.md]]                 相对当前文档目录
--   [[api.md]]                                        裸名，走解析优先级
--   ![架构图](repo/github.com/acme/web/img/arch.png)  标准 md 图片语法，同样按地址解析
--
-- ── 解析顺序（任一步出现多个候选就**不解析**，不猜） ─────────────────────
--   1. 以 repo/ group/ ext/ 开头的 → 绝对地址，直接查
--   2. ./ 或 ../ 开头 → 相对当前文档所在目录，拼成绝对地址再查
--   3. 裸名 → 同目录 → 当前 owner 根目录 → 整个 docs 根下按文件名唯一匹配
--   4. 都不中 → state='missing'，raw 原样留着（改名后可以重解析，断链也能被看见）
--
-- 这条"多义不猜"是刻意的：Obsidian 遇到重名会随便挑一个，结果是链悄悄指错地方。
-- 这里宁可显示成断链让人去补全地址。
--
-- ── 归一化：点出现在文件名里没问题，但下面这几条必须统一口径 ──────────────
-- 段内点（github.com / v1.2.3.md / a..b.md / .obsidian）**不影响解析**：分段按 / 切，
-- 只有整段恰为 '.' 或 '..' 才是相对标记。真正要处理的是这些：
--
--   1. `..` 越界必须报错，不能静默 pop
--      repo/a/b.md + ../../x.md 若一路 pop 会吃到 'repo' 变成 'x' —— 地址还在，
--      但指向完全不同的东西。归一函数遇到「退到命名空间根外面」直接返回失败。
--   2. 每段尾部的点和空格：Windows 落盘时会吃掉，登记和解析必须同口径
--      'a.md.' → 'a.md'；'a.md  ' → 'a.md'。不抹掉的话，库里登记的和磁盘上的
--      是两个字符串，永远查不到，而且没人报错。
--   3. Unicode 统一 NFC：macOS 存 NFD（e + 组合音符），Windows 存 NFC。
--      'café.md' 两种写法视觉一样、字节不同，不归一就是两个文档。
--   4. 大小写：Windows/macOS 文件系统不区分，Linux 区分。
--      **比较一律不区分大小写**（lower + NFC 作为比较键），存储保留原样（显示要对）。
--      代价：Linux 上同一目录不能有 A.md 和 a.md —— 登记第二个时应直接报冲突，
--      而不是让两份关系导到同一台机器上时撞车。
--
-- 规则的可执行原型：同目录 `link-resolver.mjs`（39 条断言已跑通：重名不猜、同 owner 优先、
-- 越界拒绝、尾部点/NFC/大小写归一、快搜排序）。改规则时先改它、跑绿，再回头改这段注释。
--
-- 注意 owner 的边界**不能靠字符串猜**：key 自己就带斜杠（github.com/acme/web），
-- 所以解析器必须拿到已登记的 key 列表做最长前缀匹配。这是签名里为什么要传 owners。
--
-- ── 快搜（输入几个字弹列表）────────────────────────────────────────────
-- 分两层，别混：
--   能不能搜到  = SQL 范围扫描（必须走索引）
--   怎么排序    = 应用层打分（文件名精确 > 文件名前缀 > 全路径前缀 > 某段前缀
--                > 文件名包含 > 子序列），同分时短地址优先
--
-- 实测过一个坑：**`LIKE 'x%'` 在 SQLite 里不走索引**（EXPLAIN 显示 SCAN），
-- 哪怕列上有索引。走索引的是范围比较：
--   CREATE INDEX ix_refs_locator ON refs (locator COLLATE NOCASE);
--   SELECT id, locator FROM refs
--    WHERE locator COLLATE NOCASE >= :q
--      AND locator COLLATE NOCASE <  :q || char(0x10FFFF)   -- 上界
--    LIMIT 20;
-- 用范围比较还有个附带好处：文件名里的 % _ [ 不用转义 —— LIKE/GLOB 才需要。
-- 候选集到手后再做模糊打分，那是内存里的事，别再回表。

-- ═══════════════════════════════════════════════════════════════════════
-- ref ↔ ref：文档里引用别的东西（双链解析后的结果）
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 文档里的一处引用。**同时存原文和解析结果**，这是这张表的重点：
--   raw      原文（[[...]] 或 ![](...) 里那段），重解析的原点
--   dst_id   解析到的 ref；解析不出来就是 NULL，但这一行照样留着
--   state    resolved / missing / external
--
-- 为什么不只存 dst_id：只存成功解析的边，断链就人间蒸发 —— 文档里明明有个红链，
-- 库里查不到，面板也没法标出来。改名之后更没有补救的抓手（raw 没了，只能重新扫文件）。
--
-- 为什么一张表里既有 links 又有 embeds：
--   两者都是「文档 A 提到文档/文件 B」，解析规则、生命周期、失效处理完全一致，
--   只有渲染方式不同（嵌进来 vs 点开）。拆两张表会让解析器写两遍。
--
-- task 正文里的引用不落这张表 —— 落 task_refs。同一个解析器，两个落点：
--   ref 的正文 → ref_relations
--   task 的正文 → task_refs
-- 原因就是开头那句：task 和 ref 都是 md，但本质不是一类东西，归属表也不该混。
CREATE TABLE ref_relations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  src_id     TEXT    NOT NULL REFERENCES refs(id) ON DELETE CASCADE,  -- 引用方文档
  dst_id     TEXT             REFERENCES refs(id) ON DELETE CASCADE,  -- 被引用；未解析为空
  raw        TEXT    NOT NULL,                       -- 原文链接串，重解析的原点
  anchor     TEXT    NOT NULL DEFAULT '',            -- #标题 / #^块，只对文档有效
  type       TEXT    NOT NULL CHECK (type IN ('embeds','links')),
  state      TEXT    NOT NULL DEFAULT 'resolved'
             CHECK (state IN ('resolved','missing','external')),
  position   INTEGER NOT NULL DEFAULT 0,             -- 在同一篇文档里的出现顺序
  created_at INTEGER NOT NULL,
  -- 同一篇文档、同一处原文、同一出现位次只算一次。
  -- 重解析的做法是「先删该 src 的全部行再插」，这条索引是漏删时的兜底。
  UNIQUE (src_id, raw, type, position),
  CHECK (src_id <> dst_id)                           -- 不能引用自己
);
CREATE INDEX ix_ref_relations_dst  ON ref_relations (dst_id);   -- 反查：这篇文档被谁引用
CREATE INDEX ix_ref_relations_raw  ON ref_relations (raw);      -- 反查：改名前谁指着我（重解析用）
CREATE INDEX ix_ref_relations_open ON ref_relations (src_id) WHERE dst_id IS NULL;  -- 断链清单

-- 单独看"断链"就是一条查询，不用扫任何 md 文件：
--   SELECT src_id, raw FROM ref_relations WHERE state = 'missing';
-- 删图之前先问"还有谁在用"：
--   SELECT count(*) FROM ref_relations WHERE dst_id = ? AND state = 'resolved';
