-- nx-kv SQLite schema（v2 草案）
--
-- 状态：设计稿。仓库代码尚未接入，本文件只用于评审与后续迁移脚本。
-- 配文：同目录 SQLITE-SCHEMA.md（决策理由、迁移映射、校验 SQL）。
-- 自检：已在 node:sqlite 内存库执行通过，配套断言见文末「校验」一节。
--
-- ── 模型就三层 ──────────────────────────────────────────────────────────
--   实体（3）：tasks / repos / refs
--   中间表（4）：task_relations / repo_relations / ref_bindings / ref_relations
--   接缝（1）：topics —— **repo 的物理代理**（逻辑身份在 repos，物理存在在 topics），
--              同时是任务的容器。不是第四个实体。
--   周边（非实体）：task_history / goals / templates / app_kv
--
--   三个实体之间两两 + 各自内部，一种关系一张表，不做万能多态边表：
--     task  ╪╪  task  → task_relations   (depends_on / fork_of)
--     repo  ╪╪  repo  → repo_relations   (member / linked)
--     task|repo ╪╪ ref → ref_bindings     (doc / attach)   ← 所有"挂文档"都走这里
--     ref   ╪╪  ref   → ref_relations    (links_to / embeds)
--
-- ── 边界（有意不进库）──────────────────────────────────────────────────
--   * ref 的正文：仍在 ~/.nx-kv/docs/**.md 或外部绝对路径。refs 只存**身份**。
--   * 附件字节：留盘（~/.nx-kv/attachments/），库里只留 id 与元数据。
--   * config.json（含 token）与 panels.json（UI 布局）：单例小数据，留 JSON。
--
-- ── 连接级 PRAGMA（驱动初始化时执行，不在 DDL 里生效）────────────────────
--   PRAGMA journal_mode = WAL;      -- serve 与 CLI 是两个进程，必须开
--   PRAGMA foreign_keys = ON;       -- 靠它挡「删组留孤儿成员」
--   PRAGMA busy_timeout = 5000;
--   PRAGMA synchronous = NORMAL;

-- ═══════════════════════════════════════════════════════════════════════
-- 一、实体 ①：任务
-- ═══════════════════════════════════════════════════════════════════════

-- 任务分区：**不是第四个实体，是 repo 的物理代理**。
--   repos 行 = 逻辑身份（key / remote / 类型，可跨机器、可漂移）
--   topics 行 = 同一个仓库在本机某个目录上的**物理存在**（cwd / cwds）
-- 两者都可缺：未登记的目录有 topic 无 repo；登记了但从没跑过任务的 repo 有行无 topic。
-- repo_id 把这条绑定显式化——此前是靠 path 字符串小写比较现拼的。
CREATE TABLE topics (
  key               TEXT PRIMARY KEY,          -- 目录名哈希，对外契约，别换自增
  -- 本队列代理的仓库。ON DELETE SET NULL：删仓库登记不该连带删掉任务队列。
  repo_id           TEXT REFERENCES repos(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  cwd               TEXT NOT NULL DEFAULT '',
  cwds              TEXT NOT NULL DEFAULT '[]', -- JSON array：同名目录见过的所有路径
  summary           TEXT NOT NULL DEFAULT '',   -- agent 当前现状
  submit_summary    TEXT NOT NULL DEFAULT '',   -- 提交方补充说明（与 summary 分开，见 #66）
  waiting           INTEGER NOT NULL DEFAULT 0,
  waiting_until     INTEGER,                    -- epoch ms
  next_seq          INTEGER NOT NULL DEFAULT 1, -- 只增不减：修掉 nextTaskId=max+1 的编号复用
  workflow_revision INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT, -- 库内主键；对外仍用 seq
  topic_key        TEXT    NOT NULL REFERENCES topics(key) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,                  -- 对外编号（= 现在的 id）
  status           TEXT    NOT NULL CHECK (status IN ('pending','consumed','archived')),
  body             TEXT    NOT NULL,                  -- 原 text：markdown ≤20k，直接 TEXT
  round_summary    TEXT    NOT NULL DEFAULT '',
  from_src         TEXT    NOT NULL DEFAULT '',       -- 原 from：'cloud' = 云端清单迁入
  claimed_from     TEXT    NOT NULL DEFAULT '',
  claimed_by       TEXT    NOT NULL DEFAULT '',
  claimed_by_name  TEXT    NOT NULL DEFAULT '',
  fork_kind        TEXT    NOT NULL DEFAULT '',       -- reopen / comment
  reopen_count     INTEGER NOT NULL DEFAULT 0,
  blocks_following INTEGER NOT NULL DEFAULT 0,        -- 闸门：挡住 seq 更大的 pending
  -- 动态扩展：给后续增强功能留的口子，**只放稀疏、实验性、不参与查询的字段**。
  -- 硬约束是"必须是 JSON 对象"（拦住 []、"str"、非法 JSON 这类误写）。
  --   要 WHERE / ORDER BY / JOIN 的 → 升成真列；
  --   指向别的实体的 → 走中间表，别塞这里（关系一旦进 JSON，反查就只能全表扫）。
  -- 键名带命名空间前缀（ext_* / feature_*）：**别用点号**，点号在 JSON path 里是
  -- 分隔符，$.ext.x 会被当成嵌套对象，得写 $."ext.x" 才拿得到。
  ext              TEXT    NOT NULL DEFAULT '{}'
                   CHECK (json_valid(ext) AND json_type(ext) = 'object'),
  migrated_to      TEXT,                              -- JSON tombstone
  created_at       INTEGER NOT NULL,
  consumed_at      INTEGER,
  completed_at     INTEGER,
  deleted_at       INTEGER,                           -- 软删（可 restore）
  last_reopened_at INTEGER,
  updated_at       INTEGER NOT NULL,
  UNIQUE (topic_key, seq)
);
CREATE INDEX ix_tasks_queue ON tasks (topic_key, status, seq);
CREATE INDEX ix_tasks_live  ON tasks (status) WHERE deleted_at IS NULL;

-- ext 里的键一旦变成高频查询条件，**不要**直接 `WHERE json_extract(ext,'$.k')=?`
-- （函数包裹后走不了索引，等于全表扫）。加一个 VIRTUAL 生成列再建普通索引即可，
-- 读路径就退化成纯整数比较，写路径由 SQLite 自己维护：
--   ALTER TABLE tasks ADD COLUMN ext_priority INTEGER
--     GENERATED ALWAYS AS (json_extract(ext, '$.priority')) VIRTUAL;
--   CREATE INDEX ix_tasks_ext_priority ON tasks (ext_priority);
-- 判据反过来也成立：一个键需要索引时，它已经不适合留在 ext 里了，优先考虑升真列。

-- 任务内部节点（重开轨迹 / 评论）：不是实体，是任务的行内明细。
CREATE TABLE task_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('origin','reopen','comment')),
  at           INTEGER NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  quote        TEXT NOT NULL DEFAULT '',
  feedback     TEXT NOT NULL DEFAULT '',
  excerpt      TEXT NOT NULL DEFAULT '',
  completed_at INTEGER,
  UNIQUE (task_id, seq)
);

-- 计时承诺（原 timegoals.json）。挂在 task 上，topic 级 goal 也允许 —— 二者互斥。
CREATE TABLE goals (
  id            TEXT PRIMARY KEY,             -- 保留原 key 形态："<topicKey>" / "task:<topicKey>:<id>"
  task_id       INTEGER REFERENCES tasks(id)   ON DELETE CASCADE,
  topic_key     TEXT    REFERENCES topics(key) ON DELETE CASCADE,
  cwd           TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  duration_sec  INTEGER NOT NULL,
  prompt        TEXT NOT NULL DEFAULT '',     -- 不可变事实：check 永远回显这句原文
  started_at    INTEGER NOT NULL,
  deadline      INTEGER NOT NULL,
  archived      INTEGER NOT NULL DEFAULT 0,
  archived_at   INTEGER,
  total_checks  INTEGER NOT NULL DEFAULT 0,
  log_truncated INTEGER NOT NULL DEFAULT 0,
  CHECK ((task_id IS NOT NULL) <> (topic_key IS NOT NULL))
);
CREATE INDEX ix_goals_deadline ON goals (archived, deadline);

CREATE TABLE goal_log (
  goal_id       TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  checked_at    INTEGER NOT NULL,
  elapsed_sec   INTEGER,
  remaining_sec INTEGER,
  overtime_sec  INTEGER,
  reached       INTEGER NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  progress      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (goal_id, seq)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 二、实体 ②：仓库 / 仓库组（一个实体，两种 kind）
-- ═══════════════════════════════════════════════════════════════════════

-- 组不是第四个实体，是仓库的「容器形态」：同样的 id / key / name / 描述，
-- 只是没有 path、不能登记为 dev/ref。「组包含哪些仓库」= repo_relations(kind='member')。
-- id 值保持现有形态（r_xxx / b_xxx）：它出现在 frontmatter、导出布局、面板 URL 里，
-- 改前缀零收益；id 是不透明标识，不要靠前缀判类型。
CREATE TABLE repos (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('repo','group')),
  key         TEXT NOT NULL UNIQUE,     -- 派生身份（name + remote），可漂移；keyCustom 时锁定
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', -- 原 desc（避开 SQL 关键字）
  notes       TEXT NOT NULL DEFAULT '',
  path        TEXT,                     -- 仅 kind='repo'
  type        TEXT,                     -- 仅 kind='repo'：dev / ref
  key_custom  INTEGER NOT NULL DEFAULT 0,
  remote      TEXT NOT NULL DEFAULT '',
  remotes     TEXT NOT NULL DEFAULT '[]', -- JSON array
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (
    CASE WHEN kind = 'repo'
      THEN path IS NOT NULL AND type IN ('dev','ref')
      ELSE path IS NULL     AND type IS NULL
    END
  )
);
CREATE INDEX ix_repos_kind ON repos (kind, sort_order);
CREATE INDEX ix_repos_path ON repos (path COLLATE NOCASE);  -- Windows 路径大小写不敏感

-- ═══════════════════════════════════════════════════════════════════════
-- 三、实体 ③：ref —— 一切「文档化内容 / 外挂资源」的唯一入口
-- ═══════════════════════════════════════════════════════════════════════

-- 凡是"有独立身份、可以被多处引用、内容在文件里"的东西，都是 ref：
--   内部文档  ~/.nx-kv/docs/<rel>        kind='md'    locator=相对路径
--   外部文档  Obsidian vault 里的 md      kind='md'    locator=绝对路径
--   文档目录  「介绍文档集」              kind='dir'   locator=相对路径或绝对路径
--   附件/图片 任务或评论里挂的文件        kind='file'/'image'  locator='attachments/<fid>.<ext>'
--   链接      http(s)                     kind='url'   locator=URL
--
-- **正文不在这里**：md 的唯一真相源是磁盘文件，库里只存身份与可重建的元数据
-- （title / hash / mtime）。这样 Obsidian 改文件、双链、zip 导出全都还能用。
--
-- id 不透明：内部新生成用 'f_'+rand；存量附件沿用其 32hex fid 当 id（迁移时直接写入）。
CREATE TABLE refs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('md','dir','file','image','url')),
  locator    TEXT NOT NULL,              -- docs 内 rel / 绝对路径 / URL / attachments/...
  title      TEXT NOT NULL DEFAULT '',   -- 展示用缓存，可重建（不是真相）
  mime       TEXT NOT NULL DEFAULT '',
  size       INTEGER,
  hash       TEXT,                       -- 内容指纹：检测外部文件是否被改过
  mtime      INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, locator)
);
CREATE INDEX ix_refs_locator ON refs (locator COLLATE NOCASE);

-- ═══════════════════════════════════════════════════════════════════════
-- 四、中间表 ①：task ↔ task（任务内部关系）
-- ═══════════════════════════════════════════════════════════════════════

-- 取代 blockBy 里的 "topicKey:id" 字符串与 forkOf 派生链。
-- depends_on = 闸门依赖（跨主题也合法，靠 dst_task_id 直接指到别处的任务）
-- fork_of    = 派生来源（重开/评论产生的新任务）
CREATE TABLE task_relations (
  src_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dst_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('depends_on','fork_of')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (src_task_id, dst_task_id, kind),
  CHECK (src_task_id <> dst_task_id)
);
CREATE INDEX ix_task_rel_dst ON task_relations (dst_task_id, kind); -- 反查：谁卡在我身上

-- ═══════════════════════════════════════════════════════════════════════
-- 五、中间表 ②：repo ↔ repo（仓库内部关系）
-- ═══════════════════════════════════════════════════════════════════════

-- member：src 是**组**、dst 是组内仓库（原 boards[].repoKeys / repo_group_members）
-- linked：dev 仓库 ↔ ref 仓库的登记绑定（原 repos[].linked 里的 {kind:'ref'}）
--   —— kind 的合法性（src 必须是 group）跨表无法 CHECK，由 db check 与写入层保证：
--      SELECT * FROM repo_relations r JOIN repos s ON s.id=r.src_id
--       WHERE r.kind='member' AND s.kind<>'group';
CREATE TABLE repo_relations (
  src_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  dst_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('member','linked')),
  position   INTEGER NOT NULL DEFAULT 0,   -- 组的成员顺序（面板按它排）
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id, kind),
  CHECK (src_id <> dst_id)
);
CREATE INDEX ix_repo_rel_src ON repo_relations (src_id, kind, position);
CREATE INDEX ix_repo_rel_dst ON repo_relations (dst_id, kind);  -- 反查：这个 repo 在哪些组里

-- ═══════════════════════════════════════════════════════════════════════
-- 六、中间表 ③：task|repo ↔ ref —— 所有「挂文档 / 挂附件」都走这张
-- ═══════════════════════════════════════════════════════════════════════

-- 一行 = 一条绑定关系，多对多。note / tag / sort_order / is_primary 全挂在关系上
-- 而不是 refs 上，因为**同一篇 md 在不同宿主下角色不同**：
--   repo/local/a.md 绑到 repo 是主篇，绑到组是补充篇 —— 两行并存，互不干扰。
--
-- 两种上下文（互斥，且各自有真实 FK）：
--   ctx_group_id   ：repo「在某个组里」的专属介绍文档（原 board.repoDocs[repoKey]）
--                    只能配 owner_kind='repo' + relation='doc'
--   ctx_history_id ：评论 / 重开节点上的附件（原 task_attachments owner_kind='history'）
--                    只能配 owner_kind='task' + relation='attach'
--
-- origin='default' 表示这行由约定路径（repoDocRel / boardDocRel / groupNoteRel）推出，
-- reset 时删掉重建；'manual' 是用户显式绑的。
CREATE TABLE ref_bindings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_id         TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  owner_kind     TEXT NOT NULL CHECK (owner_kind IN ('task','repo')),
  owner_id       TEXT NOT NULL,             -- repos.id / tasks.id 的字符串形式（多态，触发器补完整性）
  relation       TEXT NOT NULL CHECK (relation IN ('doc','attach')),
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  ctx_group_id   TEXT    REFERENCES repos(id)         ON DELETE CASCADE,
  ctx_history_id INTEGER REFERENCES task_history(id)  ON DELETE CASCADE,
  origin         TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','default')),
  note           TEXT NOT NULL DEFAULT '',
  tag            TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  CHECK (ctx_group_id IS NULL OR ctx_history_id IS NULL),                    -- 两种上下文互斥
  CHECK (ctx_group_id IS NULL OR (owner_kind='repo' AND relation='doc')),    -- 组上下文只属于 repo 文档
  CHECK (ctx_history_id IS NULL OR (owner_kind='task' AND relation='attach')),-- 历史上下文只属于任务附件
  CHECK (is_primary = 0 OR relation='doc')                                    -- 附件没有"主附件"
);

-- 同一宿主（含组上下文）同一篇 ref 只绑一次；重复添加 = 更新 note/tag（保持现语义）
CREATE UNIQUE INDEX ux_bind_once
  ON ref_bindings (ref_id, owner_kind, owner_id,
                   COALESCE(ctx_group_id,''), COALESCE(ctx_history_id,-1));
-- 每个宿主最多一篇主篇；组上下文各算一个宿主，所以一个 repo 在 G1、G2 里可各有一篇
CREATE UNIQUE INDEX ux_bind_primary
  ON ref_bindings (owner_kind, owner_id, COALESCE(ctx_group_id,''))
  WHERE relation='doc' AND is_primary=1;
CREATE INDEX ix_bind_owner ON ref_bindings (owner_kind, owner_id, relation, sort_order);
CREATE INDEX ix_bind_ref   ON ref_bindings (ref_id);   -- 反查：这篇文档被谁绑着

-- ═══════════════════════════════════════════════════════════════════════
-- 七、中间表 ④：ref ↔ ref（文档内部关系）
-- ═══════════════════════════════════════════════════════════════════════

-- links_to = md 正文里的 [[双链]]；embeds = 正文引用的图片/附件
-- 这张表是**可重建的**：删掉不影响任何数据，重新扫描 docs 树即可生成。
CREATE TABLE ref_relations (
  src_id     TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  dst_id     TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('links_to','embeds')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id, kind),
  CHECK (src_id <> dst_id)
);
CREATE INDEX ix_ref_rel_dst ON ref_relations (dst_id, kind);  -- 反查：谁指向我（未被引用的 ref = 可清理候选）

-- ═══════════════════════════════════════════════════════════════════════
-- 八、配置（不参与实体关系）
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE templates (
  id          TEXT PRIMARY KEY,             -- 'default' = 内置（不可删）
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  values_json TEXT NOT NULL DEFAULT '{}',   -- JSON 槽位默认值（不能叫 values：保留字）
  builtin     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE app_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL                           -- JSON 值（读方自己 parse）
);

-- ═══════════════════════════════════════════════════════════════════════
-- 九、多态 owner 的完整性补偿（FK 拦不住 owner_kind + owner_id 组合）
-- ═══════════════════════════════════════════════════════════════════════

CREATE TRIGGER trg_tasks_cleanup BEFORE DELETE ON tasks BEGIN
  DELETE FROM ref_bindings
   WHERE owner_kind='task' AND owner_id = CAST(OLD.id AS TEXT);
END;

CREATE TRIGGER trg_repos_cleanup BEFORE DELETE ON repos BEGIN
  DELETE FROM ref_bindings
   WHERE owner_kind='repo' AND owner_id = OLD.id;
END;
-- repos 被删时，repo_relations 走 FK CASCADE；ref_bindings.ctx_group_id 也走 FK CASCADE。

-- 跨表不变量（CHECK 做不到，因为要查另一张表的 kind）：
--   ctx_group_id 指向的必须真的是一个组（不是普通仓库）
--   member 关系的 src 必须是组
-- 只挂 INSERT：实际写入路径都是 delete+insert，UPDATE 由写入层保证，db check 兜底。
CREATE TRIGGER trg_bind_ctx_group BEFORE INSERT ON ref_bindings
WHEN NEW.ctx_group_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'ctx_group_id 必须指向 kind=group 的 repos 行')
   WHERE NOT EXISTS (SELECT 1 FROM repos WHERE id = NEW.ctx_group_id AND kind = 'group');
END;

CREATE TRIGGER trg_repo_rel_member BEFORE INSERT ON repo_relations
WHEN NEW.kind = 'member' BEGIN
  SELECT RAISE(ABORT, 'member 的 src 必须是 kind=group 的 repos 行')
   WHERE NOT EXISTS (SELECT 1 FROM repos WHERE id = NEW.src_id AND kind = 'group');
END;

-- ═══════════════════════════════════════════════════════════════════════
-- 十、可选：全文检索（可重建索引，不是真相源）
-- ═══════════════════════════════════════════════════════════════════════
-- 只在需要「跨文档搜索」时才建；删掉不影响任何数据。
-- CREATE VIRTUAL TABLE refs_fts USING fts5(ref_id UNINDEXED, title, body, tokenize='unicode61');
