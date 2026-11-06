# schema 缺口复盘

> 对象：`entities.sql`（10 张表 + 1 触发器）。
> 本文只列**缺口**和**需要 SQL 支持的能力**，不新增设计。标记「实测」的结论已在本机 `node:sqlite` 3.51.2 上跑过。
>
> **更新**：本文写完后已补 `task_refs` / `ref_relations`（任务附件与文档内嵌），
> 并撤销了「正文不可变」那条触发器（正文是可编辑的）。下面标 ⟲ 的两节据此调整。

---

## 一、还缺的表

### A. 必须有 —— 不加就等于删功能

**1. `goals` + `goal_checks`（时间目标）** ✅ **已补**

旧实现放 `~/.nx-kv/timegoals.json`，键是字符串 `"<topicKey>"` 或 `"task:<topicKey>:<id>"`，
一个字典同时装「队列级」和「任务级」两种目标。

**已按「只挂任务」重做**：`goals.task_id` 必填外键，一套作用域字符串整体消失
（队列是容器，没有"交付"这件事，队列级目标没有意义）。
`goal_checks` 每次 check 一行，`summary` 与当日 `elapsed/remaining/overtime` 存在同一行 ——
这样延期后历史不会被重算改写。`logTruncated` 不再需要（那是 JSON 整份重写时代的产物，
行级追加用 `count(*)` 就有总量）。

**2. `templates`（任务模板）**

现在在 `templates.json`，`{id, name, body, values, builtin}`。
`builtin` 那个标记尤其要进库 —— 现在的逻辑是「内置模板永远在场，被旧 store 漏掉时补回」，
这是拿代码去纠数据的错，进了库就只剩一条 `WHERE builtin = 0`。

### B. 建议不进库 —— 留在文件里更好

**3. 附件本地镜像清单（`manifest.json`）**
`{groupId, dir, files: {fileId: {name, size, contentType, syncedAt}}}`。
它是「字节已经落盘到哪」的缓存，删了能重建。进了库反而多一份要同步的真相。

**4. 设置 + 认证（`config.json`）**
混着 `autoSyncAttachments / attachmentsDir / gitRepoRoot / gitDevRoot`（设置）和
`token / groupId / baseUrl`（认证）。三个理由不进库：含凭据（进库会跟着 `.db` 一起被拷走）、
用户可能要手工编辑、多进程都要读。要进的话也该拆成两张表，不能混成 `app_kv`。

### C. 可选，取决于你要不要这些能力

**5. `topic_presence`（运行时存在感）**
`waiting / waiting_until` 是瞬态数据：wait 进程被 SIGKILL 后标志永久残留，
现在靠「截止时刻已过就不算」兜着。SQL 没有 TTL，放进 `topics` 就要永远带着这条兜底逻辑。

**6. `todo` 清单**
走的是远端 KV（无事务），不是本地库，和这次迁移无关。

---

## 二、现有表缺的字段与约束

| 缺什么 | 为什么要 | 位置 |
|---|---|---|
| `tasks.blocks_following` | **闸门功能没了**：旧语义是「挡住数组里其后所有 pending」。`task_deps` 是一对一边，表达不了「挡其后全部」 | `tasks` |
| `refs.title` ⟲ | 列表要显示名字。现在只能从 locator 反推文件名，URL 类根本没有名字。**未加，待你点头** | `refs` |
| `UNIQUE (type, locator)` ⟲ | 同一个文件被登记两次会产生两个 ref，同一篇文档在列表里出现两次。注意 `path` 类 locator 要先归一化（大小写/反斜杠）再比较 | `refs` |
| 索引：`tasks (topic_id, status, seq)` | 列表按状态筛 + 按编号排，现在没有 | `tasks` |
| 索引：`tasks (topic_id, seq)` | 迁移期与「最近 N 条」用 | `tasks` |
| 部分索引：`tasks (status) WHERE deleted_at IS NULL` | 跨队列的待领取总览 | `tasks` |

三条跨表约束只能靠触发器（CHECK 查不了别的表）：

1. `repo_group_members.group_key` 必须指向 `type='group'` 的行
2. `ref_bindings.type='group'` 时 `repo_key` 必须是组；`type IN ('repo','group_repo')` 时必须是仓库
3. `task_deps` 两端必须属于同一个 `topic_id`（你定的「范围只在队列内」）

---

## 三、需要底层 SQL 支持的能力（均已实测）

**1. 编号分配 —— 用 `RETURNING`，一次原子操作**

```sql
UPDATE topics SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1;
```
实测可用。这比「读 max(seq)+1 再写」稳，因为删队尾也不会回收编号。

**2. 「能不能领」——SQL 只做粗筛，终判留在 JS**

实测可用的粗筛：

```sql
SELECT t.id, t.seq FROM tasks t
 WHERE t.status = 'pending' AND t.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM task_deps d JOIN tasks p ON p.id = d.dep_id
                    WHERE d.task_id = t.id AND p.status <> 'done')
 ORDER BY t.seq;
```
跑出来是 #1、#3 可取（#3 的依赖 #4 已完成），#2 被 #1 挡住 —— 与预期一致。

但**闸门**那一段纯 SQL 写不出准确结果：它依赖「同一队列里数组序在它之前的还活着的任务」，
而且闸门标志本身还没进表。所以：SQL 出候选，`isReadyToClaim` 在 JS 里终判。
别为了「全用 SQL」硬凑窗口函数，那会变成两份判定逻辑，迟早不一致。

**3. 乐观锁 —— 只能应用层写，触发器做不到**

实测：`CREATE TRIGGER ... SET NEW.version = ...` 直接语法错误（SQLite 触发器不许改 NEW）。
所以 `version` 的自增只能写在每条 UPDATE 里：

```sql
UPDATE tasks SET status = 'claimed', version = version + 1
 WHERE id = ? AND version = ?;
```
`changes() = 0` 即冲突。**别指望库帮你加**，这是迁移时最容易漏的一处。

**4. 全文检索 —— FTS5 可用，但只做可重建索引**

实测 FTS5 可建。任务 `body` 想搜就建 `task_fts`（外部内容表 `content='tasks'`），
文档正文**不要**进库，需要搜就单独 `docs_fts`，`.md` 仍是唯一真相。

**5. 备份 —— `VACUUM INTO`**

WAL 模式下直接 `cp` 数据库文件会拿到不一致的快照。备份用
`VACUUM INTO 'backup.db'`，实测可用。现在 `repos.backup.<ts>.json` 那种备份策略可以直接照搬。

**6. 连接配置（写进 `schema.sql` 头，不要靠调用方）**

```sql
PRAGMA journal_mode = WAL;      -- serve 与 CLI 是两个进程
PRAGMA foreign_keys = ON;       -- 默认关，必须显式开
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA user_version = 1;        -- schema 版本，迁移脚本据此判断
```

**7. `STRICT` 表（实测可用）**

`CREATE TABLE ... ) STRICT;` 能从根上挡住「把 `'pending'` 写进 INTEGER 列」这类错。
现有 8 张表的类型声明都符合 STRICT 要求，加不加只是要不要那层保险。

---

## 四、真正的隐患（比缺表更值得先解决）

**1. 软删除和级联删除是两套语义，现在并存。**
`repos / topics / tasks / refs` 都有 `deleted_at`，但外键是 `ON DELETE CASCADE`。
于是有两条路径：软删（一行打标记，子行还在、还可见）和硬删（整棵子树消失）。
后果：软删一个仓库后，它的队列和任务仍然出现在列表里，除非每条查询都 join 上去查祖先的 `deleted_at`。
必须选一条：
- **全软删**：外键改 `RESTRICT`，删仓库前先软删子树（一次事务里递归），查询要带祖先过滤。
- **软删只做 UI 隐藏，真相是硬删**：那就把 `deleted_at` 从 schema 里去掉，改成一个单独的「回收站」表记录可撤销的删除。

**2. `waiting / waiting_until` 是瞬态数据进了持久表。**
进程被杀会残留，只能靠截止时刻兜底。要么挪进独立表（整表清空即可），要么接受这条永久兜底逻辑。

**3. 编号不复用只做了一半。**
`next_seq` 保证「单调增」，但 `tasks.seq` 的 `UNIQUE (topic_id, seq)` 允许在软删后重用同一个编号
（因为软删的行还在，反而会撞）。要靠发号只走 `next_seq` 来保证，别处不要手写 `seq`。

**4. `refs.locator` 会漂移。**
现在约定 `path` 类存**相对路径**（不存绝对路径，换机器/改 attachmentsDir 就全错），
但相对路径照样会随文件改名失效，而且不报错——读出来是空，不是异常。
需要在读的时候标失效（文件不存在 → 列表打灰），而不是让调用方以为拿到了内容。

---

## 五、要你定的四件事

1. **闸门要不要留？** 留就要给 `tasks` 加回 `blocks_following`；不留就把旧功能明确砍掉。
2. **软删除走哪条路？** 全软删（查询复杂）/ 真删 + 回收站表（schema 简单）。这条影响全部删除路径。
3. **`goals` 和 `templates` 现在建，还是等迁移脚本一起？**
4. **要不要 `STRICT`？** 加了以后所有写入都过类型检查，脏数据当场报错而不是悄悄存进去。
