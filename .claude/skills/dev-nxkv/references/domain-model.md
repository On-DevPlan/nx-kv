# 领域模型（v2 表结构）

字段细节以 `src/core/db/migrations/v1.sql`（基础全量）+ `v2.sql`（当前过渡）为准；本文只讲「谁是什么、怎么连、叫什么」。

## 1. 一句话模型

本机任务栈：**仓库 / 仓库组**登记代码与参考资料；**队列（topic）**是 `(cwd, group)` 对应的任务容器；**任务**在队列内用 `seq` 对外编号、用 `tasks.id` 做外键；**时间目标**挂在任务上；**资源**统一进 `attachments`，再通过 `task_attach` / `ref_attach` 挂到任务或文档。

## 2. 表骨架

| 表 | 业务对象 | 关键键 | 说明 |
|---|---|---|---|
| `repos` | 仓库 / 仓库组 | PK `key` | DB `type` = `dev` / `ref` / `group`（`group` 行即面板的「看板/项目组」）；`path`、`remote`、`ext` |
| `repo_group_members` | 组成员关系 | PK `(group_key, repo_key)` | `position`、`note`（仓库在组内的角色说明） |
| `topics` | 本机队列 | PK `id`；`key` UNIQUE | `key = topicKeyOf(cwd, group_key)`；`repo_key` 必填、`group_key` 可空；`next_seq` 只增不减 |
| `topic_presence` | 等待态（跨进程） | PK `topic_id` | `waiting` / `since_ms` / `until_ms` / `cancel_requested` |
| `tasks` | 任务 | PK `id`；UNIQUE `(topic_id, seq)` | `status` ∈ `pending/claimed/done/cancelled`；`body` ≤20k；`feedback` 只写一次；`blocks_following` 闸门；`round` |
| `task_deps` | 队列内依赖边 | PK `(task_id, dep_id)` | 本地 DAG 的持久边 |
| `task_links` | 派生链 | PK `(src_id, dst_id, type)` | 方向恒为「新 → 旧」；`comment` / `reopen` / `feedback`；一个任务只有一个来源 |
| `goals` | 任务级时间目标 | PK `id`；UNIQUE `task_id` | 领取即计时；`duration_sec`、`started_at`、`deadline`、`prompt` |
| `goal_checks` | check 快照 | PK `id`；FK `goal_id` | `at`、`elapsed_sec`、`remaining_sec`、`overtime_sec`、`reached`、`summary`（JSON，内含 `summary`/`progress`） |
| `refs` | 文档库 | PK `id` | v2 起**只装 `.md`**：`locator` = docs 相对路径或外部 `.md` 绝对路径 |
| `ref_bindings` | 文档挂到仓库/组 | PK `(repo_key, group_key, ref_id)` | `type` = `repo` / `group` / `group_repo`；列表顺序 |
| `attachments` | 统一资源表 | PK `id` | `kind` = `file/url/task/ref`；`storage` = `local/cloud`；`target_kind/target_key/target_seq` |
| `task_attach` | 任务 ↔ 资源 | PK `(task_id, attachment_id)` | `role` = `inline`（正文引用）/ `attach`（显式挂载）/ `doc` |
| `ref_attach` | 文档 ↔ 资源 | PK `(ref_id, attachment_id)` | `role` = `inline` / `attach` / `reference` |
| `templates` | 任务正文模板 | PK `id`；`category` | 只有 `newtask` 在用 |
| `settings` | k/v | PK `key` | `app.*`、`lt.*`、`tg.cwd.*` |
| `meta` | 库元信息 | PK `key` | `store_kind`、`schema_version`、`created_by` |

### 关系速记

```text
repos(key, type=dev/ref/group)
  ├─< repo_group_members >─ repos(key)
  ├─< topics(repo_key, group_key) ─< topic_presence
  │     └─< tasks(topic_id, seq)
  │          ├─< task_deps(dep_id)
  │          ├─< task_links(src/dst)
  │          ├─< goals(task_id) ─< goal_checks(goal_id)
  │          └─< task_attach >─ attachments(kind=file/url/task/ref)
  └─< ref_bindings >─ refs(id) ─< ref_attach >─ attachments
```

- 任务只属于一个队列；队列属于一个仓库，可选属于一个组。
- 对外编号 `#<seq>` 队列内递增；`tasks.id` 只用于外键，别混用。
- 一个任务只有一个派生来源；`reopen` 派生新任务，不回写旧任务。

## 3. 资源与文档

- `refs` 是文档库，不再装图片/文件/URL/task；这些全部进 `attachments`。
- `attachments` 身份由 `core/attachmentdb.js` 统一生成：
  - `file` → `id = fileId`；`url` / `task` / `ref` → `att_<kind>_<sha1 前缀>`；
  - `dedupe_key` 用于同一逻辑资源跨行去重（软删后可重新登记）。
- 正文里的 `fileId`、`nxkv://task/...`、`nxkv://ref/...` 是快捷入口；解析后写 `task_attach` / `ref_attach`。
- `role` 是边语义，不是资源属性：改正文只改 `inline` 边，显式挂载走 `attach`。

## 4. 规范术语

| 规范叫法 | 代码 | CLI | 避免 |
|---|---|---|---|
| **队列**（topic） | `topics`、`localtask topic` | `localtask ... --cwd` | 面板叫「目录」、文案叫「主题」；别再混用 |
| **仓库**（repo） | `repos.type='dev'` | `repo ...` | 不要用「项目」指仓库 |
| **参考仓库**（ref repo） | `repos.type='ref'` | `repo ref ...` | 不是 `refs` 文档表 |
| **仓库组 / 看板** | `repos.type='group'` + 成员表 | `board ...` | `board` 是 CLI 叫法，实体仍是仓库组 |
| **任务**（task） | `tasks` | `localtask ...` | `seq` 当全局 id |
| **文档（ref）** | `refs`、`ref_bindings` | `docs ...` | 不要叫 `docs` 表 |
| **附件** | `attachments` + 两张关系表 | `file ...`、`localtask attach` | 不要再按资源类型拆表 |
| **区块模板** | `settings.lt.blockTemplates` | 设置页 / 区块 action | 不在 `templates` 表里 |
| **工作空间** | `config.groupId`、`todo group` | `group ...` | 不是仓库组 |

## 5. 设置键组织

- `config.json` 只放凭据与会话：`baseUrl/token/email/userId/groupId`。
- `settings` 表：
  - `app.autoSyncAttachments`、`app.attachmentsDir`、`app.gitRepoRoot`、`app.gitDevRoot`
  - `lt.timeoutSec`：队列默认等待秒数
  - `lt.appendMode`：全局追加模式 `xml` / `plain`
  - `lt.blockTemplates`：**唯一权威**的提示词模板结构，`{ [blockId]: { active, list } }`，六区块 `context / attachment / timecheck / ext / ack / getloop`
  - `tg.cwd.<topicKey>`：目录级时间目标的 JSON blob
  - 旧键 `lt.promptTemplates`、`lt.activePromptTemplate`、`lt.xmlBlocks`、`lt.deliveryTemplate`、`lt.attachTemplate`、`lt.taskSuffix`、`lt.ackPrompt`：**只做一次性迁移来源**，不再写回
- 随仓库走的旋钮：`repos.ext.ext_getloop`（持续 get 窗口）。不要再往 `topics.ext.ext_auto_wait*` 写新值（旧字段只作迁移取证）。

## 6. 已删除 / 仅历史

- JSON 文件存储已被 SQLite 取代。
- 按资源类型拆开的旧关系表已删除，**没有兼容壳**；不要再按旧表名查数据。
- 自研模板解析器、区块对象（`items` / `wrapper` / `{{block.content}}`）已被 Handlebars + 共享 ctx 取代。
- 旧 `topic.key = sha1(目录名)` 已废弃；旧 key 只留在 `topics.ext.ext_legacy_key`。
- 迁移脚本里可以读旧字段/旧键，运行时一律只认新结构。
