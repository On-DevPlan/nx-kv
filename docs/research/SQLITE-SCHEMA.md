# SQLite schema 设计（v2）

> 配套 DDL：`sqlite-schema.sql`（同目录，已在 `node:sqlite` 内存库跑通，38 条约束断言全绿）。
> 原始需求与决策出处：`origin-intent.md`（用户逐字原话，含被明确否决的方案）。**本文与它冲突时以它为准。**
> 状态：**设计稿**，仓库代码尚未接入。

## 0. 模型只有三层

```
实体（3）      tasks          repos(kind=repo|group)      refs
                 │                     │                    │
中间表（4）      ├── task_relations ───┤                    │
                 │   (depends_on       ├── repo_relations ──┤
                 │    fork_of)         │   (member          │
                 │                     │    linked)         │
                 └──── ref_bindings ───┴────────────────────┘
                         (doc / attach)
                              │
                        ref_relations (links_to / embeds)
```

| 层 | 表 | 说明 |
| --- | --- | --- |
| 实体 | `tasks` / `repos` / `refs` | 只有这三张是"东西" |
| 中间表 | `task_relations` / `repo_relations` / `ref_bindings` / `ref_relations` | 一种关系一张，不做万能边表 |
| 周边 | `topics` / `task_history` / `goals` / `templates` / `app_kv` | 明细与配置，不被中间表引用 |

三对实体组合里只建了**真实存在的 4 类关系**。task 与 repo 之间不直接连边——它们通过 `topics` 这条**物理代理**相连（见下），所以不需要 `task_repo` 中间表。

### `topics` 不是第四个实体，是 repo 的物理代理

| | `repos` 行 | `topics` 行 |
| --- | --- | --- |
| 是什么 | **逻辑身份**：key / remote / 类型 | **物理存在**：某台机器上的某个目录 |
| 谁产生 | 用户登记 | 跑任务时自动派生（目录名哈希） |
| 能否缺失 | 可以不跑任务（有 repo 无 topic） | 可以没登记（有 topic 无 repo，`repo_id` 为 NULL） |

`topics.repo_id` 把这条绑定显式化。此前它是靠 `path` 字符串小写比较现拼的（`repos/service.js` 的 `byPath` 映射）：路径换盘符、改大小写、移动目录之后，绑定会**静默断掉**，而且没有任何地方会报错。

用 `ON DELETE SET NULL` 而非 CASCADE：删掉一个仓库登记不该连带删掉它的任务队列——队列是物理事实，登记只是逻辑标注。

一句话概括这条链：**任务挂在物理位置上（topic），topic 代理逻辑身份（repo）**。这也是为什么 `localtask` 在「模块互依禁列」里不能静态引用 `repos`，却仍然知道自己在哪个仓库里干活。

## 1. `ref` 的边界：什么进 ref，什么不进

用户定的语义是「所有文档化的内容都用 ref 作为基础设施」。落地判据是三条，全中才进 `refs`：

1. **有独立身份**——能被两处以上引用；
2. **内容在文件里**（或是个 URL），库里只该存身份；
3. **可以和别的东西解除绑定而自身仍存在**。

对照结果：

| 内容 | 去处 | 理由 |
| --- | --- | --- |
| 介绍文档 md（内部 `docs/` / Obsidian vault） | `refs` | 一篇 md 可同时绑 repo 和组，典型多对多 |
| 文档目录（"介绍文档集"） | `refs(kind='dir')` | 同上，只是粒度粗一级 |
| 任务附件 / 评论配图 | `refs(kind='file' 或 'image')` | 同一张图可被多任务引用 |
| 外部链接 | `refs(kind='url')` | 只需身份与标题 |
| **任务正文** | `tasks.body` 列 | 单一宿主、没有独立身份、每次列表都读，抽出去只多一次 join |
| **任务历史节点** | `task_history` 行 | 它是结构化事件（状态快照 / 引用 / 反馈），不是文档；但它的附件是 ref |
| **topic** | `topics` 行 | 任务的分区命名空间，只承担编号分配 |

**正文不进库**：md 的真相源是磁盘。一旦正文入库，Obsidian 改文件、`[[双链]]`、zip 导出、外部编辑器全部失效。库里只存 `locator` + 可重建的 `title/hash/mtime`。

`locator` 归一化规则：在 `~/.nx-kv/docs` 内的存**相对路径**，外部存**绝对路径**，附件存 `attachments/<fid>.<ext>`，链接存 URL。`UNIQUE(kind, locator)` 保证同一个文件不会被登记成两条 ref。

## 2. 组不是第四个实体

`repos.kind='group'` 就是组：同样的 id / key / name / description，只是 `path` 与 `type` 为 NULL（CASE 型 CHECK 强制）。

这条带来一个**实际简化**：`ref_bindings` 不需要 `owner_kind='repo_group'`。组是 repos 的一行，所以：

| 绑定形态 | ref_bindings 一行 |
| --- | --- |
| repo 自己的介绍文档集 | `owner_kind='repo'`, `owner_id=<repo id>`, `ctx_group_id=NULL` |
| **组自己的介绍文档集** | `owner_kind='repo'`, `owner_id=<group id>`, `ctx_group_id=NULL` |
| repo 在某组里的专属文档 | `owner_kind='repo'`, `owner_id=<repo id>`, `ctx_group_id=<group id>` |
| 任务挂文档 / 附件 | `owner_kind='task'`, `owner_id=<task id>` |
| 评论 / 重开节点上的附件 | `owner_kind='task'`, `owner_id=<task id>`, `ctx_history_id=<history id>` |

v1 里的 `repo_group` 枚举值、`trg_groups_cleanup` 触发器、两段近乎重复的归一化代码，全部消失。

## 3. 为什么是「每种关系一张」，不是一张万能边表

一张 `links(src_kind, src_id, dst_kind, dst_id, rel, ...)` 看起来最省表，但代价是：

- **FK 全是假的**：`src_id` 不能指向三张表，只能靠触发器补，删一张表要扫全表；
- **列被迫全 nullable**：`position` 只对 member 有意义，`note/tag/is_primary` 只对 doc 有意义，`ctx_group_id` 只对 repo 文档有意义；
- **约束要靠 `rel` 上的巨型 CHECK** 表达"哪种组合配哪列"，改一个关系就得改 CHECK。

四张表各自的列和 FK 都是真的，代价只是多三张建表语句。关系数量由**真实需求**决定（现在是 4），不是由"实体两两组合"决定（那是 9）。

## 4. `ref_bindings` 的三处非显然设计

**4.1 属性挂在关系上，不挂在 ref 上。** 同一篇 `repo/local/a.md` 绑到 repo 是主篇、绑到组是补充篇——角色属于这次绑定。所以 `note / tag / sort_order / is_primary / origin` 都在绑定行上。

**4.2 两条 partial unique index 把旧不变量抬到数据库级：**

```sql
-- 同一宿主（含组上下文）同一篇只绑一次；重复添加 = 更新 note/tag（保持现语义）
CREATE UNIQUE INDEX ux_bind_once ON ref_bindings
  (ref_id, owner_kind, owner_id, COALESCE(ctx_group_id,''), COALESCE(ctx_history_id,-1));
-- 每个宿主最多一篇主篇
CREATE UNIQUE INDEX ux_bind_primary ON ref_bindings
  (owner_kind, owner_id, COALESCE(ctx_group_id,''))
  WHERE relation='doc' AND is_primary=1;
```

`COALESCE(ctx_group_id,'')` 是必需的：SQLite 里 NULL 在唯一索引中互不相等，不套函数等于没约束。

**4.3 跨表不变量用两个 INSERT 触发器补。** `CHECK` 查不了另一张表的 `kind`，所以：

- `ctx_group_id` 指向的必须真的是组（不是普通仓库）；
- `repo_relations.kind='member'` 的 `src` 必须是组。

这两个是最容易写错、且错了不会报错的地方，值得从应用层挪进库。

## 5. `origin='default'`：把约定路径物化成数据

现在 `repoDocRel(key)` / `boardDocRel(name)` / `groupNoteRel(group, key)` 在读的时候现算路径，`doc` 字段只是"覆盖"，没配就回落到约定。隐式规则的三个代价：SQL 查不到"这个 repo 到底有哪些文档"、`--reset` 是"删覆盖"而不是"恢复到某行"、每个读方都要记得先回落。

迁移时把约定路径也写成 `origin='default'` 的绑定行，于是「某 repo 的文档清单」= 一条 `WHERE owner_kind='repo' AND owner_id=?`。行数代价可忽略（42 repo + 4 组 + 成员 ≈ 百来行）。

**文件路径不迁**：存量组的主篇仍在 `board/<名>.md`，`refs.locator` 指向它。改名只发生在表与代码层，不动用户的 md——这正是不靠"约定路径现算"换来的解耦。

## 6. `tasks.ext`：动态扩展的口子

任务行留了一列 `ext TEXT NOT NULL DEFAULT '{}'`，CHECK 强制 `json_valid(ext) AND json_type(ext)='object'`。它只有一个目的：**以后加功能不必改 schema**。

边界只有一条，但两侧都是坑：

| 想放进去的东西 | 该不该进 ext |
| --- | --- |
| 实验特性开关、UI 展示偏好、外部系统 id 映射、来源标记 | 进 |
| 会出现在 `WHERE` / `ORDER BY` / `JOIN` 里的 | **不进**，升真列（见下面的生成列） |
| 指向另一个实体的（依赖、派生、附件、文档） | **不进**，走中间表 —— 关系进 JSON 后反查只能全表扫 |
| 多行结构化数据（一串对象） | **不进**，开新表 |

键名带命名空间前缀（`ext_*` / `feature_*`）。**别用点号**：`.` 在 JSON path 里是分隔符，`$.ext.x` 会被解析成"ext 对象下的 x"，得写成 `$."ext.x"` 才取得到——这个坑不值得每个人都踩一次。

**现网 75 个任务的字段分布，正好是这套判据的实例**：

| 现有字段 | 出现数 | 去向 |
| --- | --- | --- |
| `remote` | 33 | **升真列** `remote_id`：云端同步要按它查 |
| `pickupSec` | 12 | 进 ext：只做统计展示 |
| `trashIndex` | 4 | 进 ext：回收站排序，无跨行查询 |
| `archivedAt` / `archivedReason` | 1 | 进 ext：稀疏，归档态已由 `status` 表达 |
| `supersededBy` | 1 | 走 `task_relations`（kind 补一个 `superseded`），不是 ext |
| `forkOf` / `blockBy` | 1 | 走 `task_relations` |
| `ready` | 1 | **丢掉**：计算缓存，不持久化 |

一个键开始需要索引时，它就该搬出 ext 了：

```sql
ALTER TABLE tasks ADD COLUMN ext_priority INTEGER
  GENERATED ALWAYS AS (json_extract(ext, '$.priority')) VIRTUAL;
CREATE INDEX ix_tasks_ext_priority ON tasks (ext_priority);
```

必须是 VIRTUAL 而非 STORED：VIRTUAL 不占空间、写入零成本、读时才算；只有某个键被高频读取、`json_extract` 真成了热点，才值得换 STORED。

`migrated_to` 保持独立列、没并进 ext —— 迁移脚本与 restore 都要按它判断，属于高频查询路径，正是"该升真列"的那一类。

## 7. 迁移映射（JSON → 表）

| 旧字段 | 新落点 |
| --- | --- |
| `repos[i]`（dev/ref 仓库） | `repos(kind='repo', path, type, remote, remotes)` |
| `boards[i]` | `repos(kind='group', path=NULL, type=NULL)` |
| `boards[i].repoKeys[j]` | `repo_relations(src=组, dst=repo, kind='member', position=j)` |
| `repos[i].linked[].kind='ref'` | `repo_relations(kind='linked')` |
| `repos[i].doc` / `board[i].doc` | `refs` + `ref_bindings(relation='doc', is_primary=1, origin='manual')` |
| `repos[i].docLinks[j]` / `board[i].docLinks[j]` | `ref_bindings(relation='doc', is_primary=0, sort_order=j, note, tag)` |
| `boards[i].repoDocs[rk]` | `ref_bindings(relation='doc', is_primary=1, ctx_group_id=组 id)` |
| 无绑定但有约定路径 | 补 `ref_bindings(origin='default')` |
| `topics[t]` | `topics`（`next_seq = max(seq)+1`） |
| `topics[t].cwd` 与 `repos[].path` 的小写匹配 | `topics.repo_id`（原先靠 `byPath` 现拼；匹配不上则 NULL） |
| `tasks[i].text` | `tasks.body` |
| `tasks[i].id` | `tasks.seq`（`tasks.id` 是新自增主键） |
| `tasks[i].blockBy`（数字） | `task_relations(kind='depends_on')` 同主题 |
| `tasks[i].blockBy`（`key:id`） | 同上，跨主题反查 `tasks.id` |
| `tasks[i].forkOf` | `task_relations(kind='fork_of')` |
| `tasks[i].history[]` | `task_history(seq=下标+1)` |
| `history[].attachments[]` / 任务附件 | `refs(kind='file' 或 'image', id=fid)` + `ref_bindings(relation='attach', ctx_history_id=...)` |
| `timegoals[key]` | `goals`（id 保留原 key 形态） |

`ext` 迁移时一律初始化为 `{}`；上表之外的稀疏字段按 §6 的判据分流，不要图省事整包 JSON 塞进去（一旦塞了，以后想问"哪些任务有 X"就只能全表扫）。

时间字段一律 **epoch ms**：现在的 `"YYYY-MM-DD HH:mm:ss"` 本地时区字符串在 SQL 里既不能比大小也建不了有效索引（字典序恰好可用纯属运气），而 `deadline` / `consumed_at` 恰恰要排序和范围扫描。迁移用现成的 `parseStampMs`，**不要**用 `new Date(str)`（Node 与浏览器解析口径不一致）。

## 8. 迁移后必须跑通的校验 SQL

```sql
-- 主篇唯一（应 0 行）
SELECT owner_kind, owner_id, COALESCE(ctx_group_id,'') s, count(*) c
FROM ref_bindings WHERE relation='doc' AND is_primary=1 GROUP BY 1,2,3 HAVING c>1;

-- 孤儿绑定（owner 已不存在，应 0 行）
SELECT * FROM ref_bindings b WHERE b.owner_kind='repo'
  AND b.owner_id NOT IN (SELECT id FROM repos);

-- 组上下文只能落在真实成员上（应 0 行）
SELECT * FROM ref_bindings b WHERE b.ctx_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM repo_relations m
                  WHERE m.src_id=b.ctx_group_id AND m.dst_id=b.owner_id AND m.kind='member');
```

再加逐项计数（topics / tasks / 依赖边 / history 节点 / 绑定条目）与每条 `tasks.body` 的长度 + hash 对比——任何一项不等就整体回滚，保留原 JSON。备份用 `VACUUM INTO 'backup.db'`（WAL 下直接复制文件会拿到不一致副本）。

## 9. `boards` 改名的波及面：三处 board 不是一回事

| 含义 | 位置 | 处理 |
| --- | --- | --- |
| ① repo 组 | `store.boards`、`boardKeyOf()`、`nx-kv board list/assign`、`/api/boards*`、frontmatter `board/boardIntro/boardDesc` | **改** |
| ② 任务面板 UI 模块 | `src/web/frontend/modules/board/` | 不改（指任务看板视图） |
| ③ 任务正文 frontmatter | `tasks.body` 里的 `board: b_xxx` | 读兼容、写新字段，**不批量重写用户正文** |

分两刀：**数据层**（`repos.kind='group'` + service 命名，可单独发版）→ **对外层**（CLI `board`→`group` 保留别名、`/api/boards`→`/api/groups`、前端 350 行、`assets/*/SKILL.md` 26 行）。第二刀必须同批：`tests/unit/registry.test.mjs` 会扫前端 `/api/` 字面量对路由表，API 改了前端没改当场红。

id 值不重写（`r_xxx` / `b_xxx`）：它出现在 frontmatter、导出布局、面板 URL 里，改前缀零收益。id 是不透明标识，不要靠前缀判类型。

## 10. 待你拍板

1. `refs.kind` 是否要 `url`？（现在 `linked` 里已经有外链，但可能全走 `repos.linked`）我倾向保留，成本为零。
2. 组是否要独立 `key` 前缀（`group/<名>` vs `board/<名>`）？我倾向新组用 `group/`，存量不动。
3. `ref_bindings` 是否要允许 `owner_kind='group'` 这三个值？我按第 2 节统一成 `repo` 了——如果你希望"组"在语义上独立，改回去只是加个枚举值 + 触发器。
