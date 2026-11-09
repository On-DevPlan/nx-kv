-- schema v3：任务模板的可见域（scope）与创建来源（origin_topic）
--
-- 设计口径（2026-11-09，任务 #128，评估见 plan/2026-11-09-template-architecture-eval.md §2）：
--   · 模板从「全机共享」升级为「带可见域」：scope 是 JSON 数组，条目三种前缀——
--       "*"            全局可见（缺省，行为与 v2 完全一致）
--       "topic:<key>"  指定队列主题可见（topics.key）
--       "repo:<key>"   指定项目可见（repos.key）
--       "group:<key>"  指定项目组可见（组也是 repos.key）
--     可见判定 = scope 含 "*"，或命中主题行的 key / repo_key / group_key 任一。
--   · origin_topic 记录「在哪个主题里创建的」：从主题页新建模板时默认只在该主题
--     可见（scope 默认 [topic:<key>]），origin 是创建事实、不随 scope 改写；
--     它同时是「编辑权」的锚（canEdit = origin 命中或 scope 显式点名本主题）。
--
-- 两列都带 NOT NULL DEFAULT：存量模板（含内置 seed 的四类目）原地升级为全局
-- 可见，零破坏——不跑数据回填脚本。

-- @decision docs/decisions/versions/2026-11-09-v3.md
ALTER TABLE templates ADD COLUMN scope TEXT NOT NULL DEFAULT '["*"]'
  CHECK (json_valid(scope) AND json_type(scope) = 'array');
ALTER TABLE templates ADD COLUMN origin_topic TEXT NOT NULL DEFAULT '';
