# 迁移前审计（go / no-go）

> **状态：P0 已全部处理完，可以进重构。**
> 剩三个非阻塞决策（见最后一节），不挡迁移。
>
> 结论依据：本机真实数据（75 条任务 / 18 个队列）+ 源码实测，不是估的。

---

## P0-1　PRAGMA 缺失 ✅ 已补

SQLite 的外键**默认关闭、且按连接生效**。以前 `entities.sql` 里一条 PRAGMA 都没有 ——
表建得出来，但所有 `REFERENCES` 都不起作用：删仓库不级联、依赖能指向不存在的任务，
而且**不报错**。（145 条断言一直全绿，是因为我在每个测试脚本里手开了 `PRAGMA foreign_keys=ON`。）

现在写在文件最前面：

```sql
PRAGMA journal_mode = WAL;      -- serve 与 CLI 两个进程同时写
PRAGMA foreign_keys = ON;       -- 默认关，每个连接都要设
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA user_version = 1;
```

## P0-2　代码在用的字段没建列 ✅ 已处理

按 75 条真实任务逐字段核对后，**只补了三个，其余按裁定丢弃或合并**：

| 字段 | 原出现 | 处理 |
|---|---|---|
| `roundSummary` | 70 / 75 | **不建列** —— 就是任务完成时的回调结论，与 `feedback` 同一件事，合并进 `feedback` |
| `remote` | 33 / 75 | **不建列** —— 不做远程任务融合 |
| `claimedFrom` / `claimedBy` / `claimedByName` | 12 / 75 | **不建列** —— 本地任务管理，没有"领取人"概念 |
| `from` | 9 / 75 | ✅ 建列 `from_src`（`FROM` 是 SQL 关键字，裸用要一直加引号；对外 JSON 仍是 `from`） |
| `migratedTo` | 9 / 75 | **不建列** —— 不要迁出逻辑 |
| `blocksFollowing` | 1 / 75 | ✅ 建列（为什么不能只靠 `task_deps`，见下） |
| `pickupSec` / `trashIndex` | 12 / 4 | 进 `tasks.ext` |

队列侧：`summary` / `submitSummary` **不建列** —— 队列只是开发侧概念，用户只关心任务。
等待状态已移出（见 P0-3）。

### `blocksFollowing` 为什么还是留了一列

问过"能不能用 `task_deps` 查出来"——**单靠 deps 查不出来**，因为两者语义不同：

- `task_deps` 是**逐对边**：A 等 B 完成。
- 闸门是**一条挡住后面一整片**，而且是**动态的**：它之后新加的任务也要被挡。

要物化成边，就必须在每次插入任务时扫一遍前面所有带闸门的任务；而这个"哪些是闸门"
的信息本身仍需要一个标记。等于多了一条维护路径 + 一个标记，没省下来。
所以保留布尔列，读取时判：

```sql
EXISTS (SELECT 1 FROM tasks g
         WHERE g.topic_id = t.topic_id AND g.seq < t.seq
           AND g.status = 'pending' AND g.blocks_following = 1)
```

如果你要的是**严格 FIFO**（只有最小 seq 可领），那连这一列都不用 —— 但就没了并行领取。

## P0-3　软删除与唯一索引打架 ✅ 已按「身份 / 实例」分开

| 类型 | 表 | 规则 |
|---|---|---|
| 身份型 | `repos.key`（主键） | **不可重用**。删了再建同名 key 等于两份关系指同一个名字。API 应提示恢复（restore），不是新建 |
| 实例型 | `topics` / `goals` / `templates` | **可重建**。唯一索引一律带 `WHERE deleted_at IS NULL` |

```sql
CREATE UNIQUE INDEX ux_topics_cwd_group
  ON topics (cwd COLLATE NOCASE, COALESCE(group_key,''))
  WHERE deleted_at IS NULL;
```

`tasks.seq` 不在两者之内：编号只增不减，软删的任务仍占着编号 —— 这是刻意的，
复用编号会让历史引用指向另一条任务。

## P0-4　瞬态数据搬出 `topics` ✅ 已搬

`waiting` / `waiting_until` 挪到 `topic_presence(topic_id PK, waiting, since_ms, until_ms, cancel_requested)`。

理由不是洁癖：进程被 SIGKILL 时 `finally` 不执行，标志会永久残留。独立成表后
**残留只污染这张小表，可以整表清空**，不会让队列本身看起来像有人在等。
判据始终是两条：`waiting=1` **且** `until_ms > now`。

---

## 新增：`topics.ext` + 自动等待

队列加了 `ext`（JSON），放"这个队列怎么跑"的旋钮，不放业务内容：

```json
{ "ext_auto_wait": 1, "ext_auto_wait_sec": 300 }
```

语义：**没有任务时，`get` 自动转成等**；到点直接返回空，不报错。
这样 CLI 只有 `get` 一个动作，调用方不必先判断该用 `get` 还是 `wait`。
优先级：**单次参数（`--wait` / `--no-wait` / `--timeout`）> 队列 `ext` > 全局设置**。

---

## 新增的两个索引

```sql
CREATE INDEX ix_tasks_pending ON tasks (topic_id, seq)
  WHERE status = 'pending' AND deleted_at IS NULL;   -- 取任务 + 闸门判定
CREATE INDEX ix_tasks_open ON tasks (status)
  WHERE deleted_at IS NULL;                          -- 跨队列总览（以前会全表扫）
```

---

## 还剩三个非阻塞决策

1. **要不要 `STRICT`**（3.51 支持）。加了以后把 `'pending'` 写进 INTEGER 列会当场报错，
   而不是悄悄存进去。属于"要不要那层保险"，不影响结构。
2. **`refs.type` / `state`、`repos.state`、`topics.state` 的取值**。现在都是自由 TEXT，
   没有 CHECK。等各模块的取值定下来再收紧，一次一条。
3. **`repos.key` 删除后的提示文案**。逻辑是"恢复而不是新建"，但 API 层要不要真的做
   `restore` 入口，还是只报错，取决于面板要不要"回收站"。

---

## 迁移脚本要点（不变）

**顺序**：`repos → repo_group_members → topics → tasks → task_links → task_deps
→ goals → goal_checks → refs → ref_bindings / task_refs / ref_relations → templates`

**校验**（任何一项不匹配就整体回滚，保留原 JSON）：行数、每条 body 的哈希、
`seq` 与原 `id` 的对应、依赖边数/链边数/goal_checks 条数、`next_seq ≥ max(seq)+1`。

**备份**：WAL 下别直接复制 `.db`，用 `VACUUM INTO 'backup.db'`。

**留磁盘不迁**：`docs/**/*.md`、`attachments/` + `manifest.json`、`config.json`、`panels.json`。

---

## 当前规模

**14 张表 · 21 个索引 · 1 个触发器**，六套断言 **159 条全绿**
（队列 26 / 关系 36 / 解析 39 / 目标 17 / 模板 22 / 渲染 19）。
