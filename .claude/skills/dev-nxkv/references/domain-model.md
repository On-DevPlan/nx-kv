# 领域模型：概念、表结构与术语

目标：十分钟内建立正确模型。字段细节以 `src/core/db/schema/001.sql` 的注释为准；本文只讲「谁是什么、怎么连、叫什么」。

## 1. 一句话模型

**仓库 / 仓库组**登记代码与参考资料；**队列（topic）**是本机 `(cwd, group)` 对应的任务容器；**任务（task）**属于一个队列，用队列内 `seq` 对外编号、用全局 `tasks.id` 做外键身份；任务的**依赖、闸门、派生链、时间目标、附件引用**围绕任务行展开；**ref** 是文档/文件索引，不等于任务正文里的附件。

## 2. 表骨架（真实 schema）

| 表 | 业务对象 | 主键 / 关键外键 | 在链路中的位置 |
|---|---|---|---|
| `repos` | 仓库或仓库组（`type` = `repo`/`group`） | PK `key` | 一切归属的根；`topics.repo_key`、`repo_group_members.*`、`ref_bindings.*` 都指向它 |
| `repo_group_members` | 仓库组成员关系 | PK `(group_key, repo_key)`，两列都 FK `repos(key)` | 决定「一个项目挂在哪些组」；`position` / `note` 是组内展示 |
| `topics` | 本机队列 | PK `id`；`key` UNIQUE；FK `repo_key`、`group_key` → `repos(key)` | 任务容器；`key` 由 `(cwd, group_key)` 纯函数派生，不是第二个身份 |
| `topic_presence` | 队列等待态（SSE 用） | PK/FK `topic_id` → `topics(id)` | `wait` 是否阻塞、取消、截止时间 |
| `tasks` | 任务 | PK `id`；FK `topic_id`；UNIQUE `(topic_id, seq)` | 业务主体；`body` 是正文，`seq` 是 CLI 显示的编号 |
| `task_deps` | 队列内依赖边 | PK `(task_id, dep_id)`，两列 FK `tasks(id)` | 本地 DAG 的持久边；跨队列依赖不在本表 |
| `task_links` | 派生链（comment/reopen/feedback） | PK `(src_id, dst_id, type)` | 反馈再开一轮时派生新任务，保留历史链 |
| `goals` | 任务级时间目标 | PK `id`；FK `task_id` | 领取时开始计时，交付时校验 |
| `goal_checks` | 时间目标的检查快照 | PK `id`；FK `goal_id` | 记录某刻已用/剩余/超时与 summary |
| `refs` | 文档索引（md/dir/image/file/path/url） | PK `id`（TEXT，locator 的纯函数） | 文档索引层：内容仍在 `~/.nx-kv/docs/` 或外部路径，ref 只做稳定身份/孤儿清单 |
| `ref_bindings` | ref 挂到仓库/组的列表 | FK `repo_key`、`group_key`、`ref_id` | 仓库页与组页展示的参考文档 |
| `task_refs` | 任务 ↔ ref | PK `(task_id, ref_id)` | **当前无业务写入方**；任务附件仍以正文 markdown + 本机附件仓为主 |
| `ref_relations` | 文档内部引用/嵌入 | PK `id`；FK `src_id`、`dst_id` → `refs(id)` | 双链索引；**当前业务未写入，迁移后为空** |
| `templates` | **任务正文模板** | PK `id`；`category` | 「任务模板」tab；`newtask` 在用，`delivery/enhance/context` 是历史 seed 行 |
| `settings` | k/v 设置 | PK `key` | `app.*` 偏好 + `lt.*` 队列/提示词设置 |
| `meta` | 库自身元信息 | PK `key` | `store_kind`、`schema_version`、`created_by`；启动时校验，防误改别人的库 |

### 关系速记

```text
repos(key, type=repo/group)
  ├─< repo_group_members >─ repos(key)
  ├─< topics.repo_key / topics.group_key
  │     topics(id)
  │       ├─< tasks(topic_id, seq)
  │       │    ├─< task_deps(dep_id → tasks.id)
  │       │    ├─< task_links(src/dst → tasks.id)
  │       │    ├─< goals(task_id) ─< goal_checks(goal_id)
  │       │    └─< task_refs(ref_id)        （预留，未写入）
  │       └─< topic_presence(topic_id)
  └─< ref_bindings(repo_key/group_key, ref_id) ─< refs(id) ─< ref_relations
```

- 一个任务只属于一个队列（`tasks.topic_id`）；队列属于一个仓库（`repo_key`），可选属于一个仓库组（`group_key`）。
- 任务对外编号是 `#<seq>`（队列内递增）；`tasks.id` 只在仓储/外键/跨队列依赖里出现，别混用。
- 附件：任务正文里的 markdown 引用 + `core/localatt` / 云端 fileId + `app.attachmentsDir`；`task_refs` 目前不是可信来源。

## 3. 规范术语（以及现存叫法不一致）

新代码、新文档、新 UI 一律用「规范叫法」；历史别名只在读旧代码时参考。

| 规范叫法 | 代码 | CLI | UI / 历史别名 | 必须避免 |
|---|---|---|---|---|
| **队列**（topic） | `topics`、`localtask topic`、`repo/topics.js` | `localtask topic ...`；文案里出现过「主题」 | 面板 page `dir` 显示「目录」；登记入口说「工作目录」 | 新文案不要再把本地队列叫「主题」，也不要把「目录」当成实体名 |
| **云端主题**（cloud topic） | `modules/todo` 的 KV 主题 | `todo topic ...`、`prompt topic ...` | 文案直接叫「主题」 | 与本地队列是两回事；不要互相套用 key/编号 |
| **仓库**（repo） | `repos.type='repo'` | `repo ...` | 面板仓库页；UI 偶见「项目」 | 不要用「项目」指仓库组；本 skill 统一叫仓库 |
| **仓库组**（repo group） | `repos.type='group'` + `repo_group_members` | 历史入口 `board ...` | 面板页面叫「项目组」 | 代码/文档用 repo group；`board` 只是历史 CLI 别名 |
| **任务**（task） | `tasks` | `localtask add/get/done/...` | 任务 | 不要把 `tasks.id` 当对外编号，也不要把 `seq` 当全局外键 |
| **文档 / 参考文件**（ref） | `refs`、`ref_bindings` | `docs ...`、仓库绑定命令 | UI「文档」 | 没有被叫 `docs` 的表；ref 是索引，不是正文 |
| **任务模板** | `templates.category='newtask'` | `template ...`（templates 模块） | 设置页「任务模板」 | 不要用它改提示词渲染 |
| **区块模板** | 设置中的 per-block 模板列表 | `localtask ... setting` | 设置页各区块的模板列表 | 不在 `templates` 表里，也不是一份全局列表 |
| **工作空间**（cloud workspace） | `config.groupId`、`todo group` | `group ...` / `todo group` | 面板「工作空间」 | 不是仓库组，也不是本地队列 |
| **附件** | 正文引用 + localatt / 云端 fileId | `file ...`、`attach` | 「附件 / 图片」 | 当前不要依赖 `task_refs` 表 |

已知的不统一（按规范写法纠正，不必顺手大改存量 UI）：本地队列在 CLI/文案里叫「主题」、面板路由叫 `dir`/「目录」；仓库组在 CLI 叫 `board`、面板叫「项目组」；云端工作空间和仓库组都出现的 `group` 一词必须靠上下文区分。

## 4. 设置类数据的键组织

### `config.json`（只放凭据与会话身份）

`CREDENTIAL_KEYS`：`baseUrl`、`token`、`email`、`userId`、`groupId`。**绝不**把偏好或提示词写进 config.json。

### `settings` 表

| 键 | 含义 | 状态 |
|---|---|---|
| `app.autoSyncAttachments` / `app.attachmentsDir` / `app.gitRepoRoot` / `app.gitDevRoot` | 附件自动同步、附件目录、参考仓库根、开发仓库根 | 当前权威 |
| `lt.timeoutSec` | 队列默认等待超时 | 当前权威 |
| 提示词区块模板 | **每个区块各自一份模板列表**（`context` / `attachment` / `timecheck` / `ack` / `getloop`），列表内含系统内置与用户模板，并记录该块当前生效项；具体键结构以 `src/modules/localtask/repo/settings.js` 为准 | 当前权威，保存即生效 |
| `lt.appendMode` | 全局追加模式（`xml` / `plain`） | 当前权威，整体生效 |
| `lt.deliveryTemplate` / `lt.attachTemplate` / `lt.taskSuffix` / `lt.ackPrompt` / `lt.xmlBlocks` | 旧版模板键 | **仅迁移来源**；不再作为读写模型 |

迁移口径：读取旧库时把旧键映射到各区块的模板列表，并保证每个区块至少有一个系统内置模板；`{{block.content}}` 只用于兼容旧配置，新模板禁止使用。

### 队列 / 仓库组级旋钮（不在 `settings` 表）

| 位置 | 键 | 含义 |
|---|---|---|
| `topics.ext` | `ext_auto_wait` / `ext_auto_wait_sec` | 该队列无任务时 `get` 是否自动等待、等多久（参数 > ext > 全局 `lt.timeoutSec`） |
| `repos.ext`（仅 repo） | `ext_getloop` | 项目级「持续 get」窗口配置，渲染进 `getloop` 区块 |

不要把这些又塞回 `lt.*`：它们随队列/仓库走，`settings` 只放全局默认与提示词。

### `templates` 表

只承载**任务正文模板**。`newtask` 是当前「任务模板」入口；`delivery` / `enhance` / `context` 是旧 seed 行，**不参与提示词渲染**。改提示词请改对应区块的模板列表（设置页/区块 action），不要改 `templates` 表。

## 5. 已删除 / 仅迁移期存在的东西

- JSON 文件存储（`localtasks.json`、原子 rename、文件锁）已被 SQLite 取代；不要再引入文件型业务数据。
- 自研模板解析器、区块对象（`items` / `wrapper` / 每块变量表 / `{{block.content}}`）已被 Handlebars + 共享 ctx 取代。
- 提示词配置按区块独立，每块维护自己的模板列表与生效项。
- `task_refs`、`ref_relations` 目前只有表与迁移/校验代码，没有业务写入方；不要把「表存在」当成「功能已在用」。
- 旧 `topic.key = sha1(目录名)` 已废弃，不解析别名；旧 key 仅留在 `topics.ext.ext_legacy_key` 取证。
