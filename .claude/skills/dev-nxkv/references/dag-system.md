# 依赖、闸门与工作流引擎

## 1. 两种存储形态，一个判定内核

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 本地依赖（同队列） | `task_deps(task_id, dep_id)` | 两列都是**全局 `tasks.id`**；JSON/CLI 视图里是队列内 `seq` |
| 跨队列依赖 | `tasks.ext.ext_deps_foreign`（`"<topicKey>:<taskId>"`） | 绝对地址，搬家不失效；**不进本队列引擎节点图** |
| 闸门 | `tasks.blocks_following`（0/1） | 动态屏障：挡住同队列中 `seq` 比它大的所有 pending，直到它完成 |
| 队列顺序 | `topics.ext.ext_task_order`（seq 数组） | 看板/列表顺序；不在 `tasks.seq` 上 |
| 工作流状态 | `topics.ext.ext_workflow_state` / `ext_workflow_plugins` | 引擎插件状态 |
| 快照版本 | `topics.version` | 快照 CAS 的 revision（历史遗留同名） |

`core/workflow/readiness.js` 是唯一判定内核：任务行先投影成轻量图（`taskToNode` + `edgesFromTasks`），本地依赖和闸门走 `isNodeReady`；跨队列依赖由 `resolveForeign` 前置直查。两条入口（任务行 / 快照）必须同源，`tests/unit/readiness-consistency.test.mjs` 钉死一致性。

## 2. 依赖语义

- **本地依赖**：`blockBy` 里的数字/数字串 = 队列内 `seq`。写入 `task_deps` 时按 `(topic_id, seq)` 解析成全局 `tasks.id`；读取时反向映射回 `seq`。**禁止把 `seq` 直接写入 `dep_id`**（多队列下会指向别的任务）。
- **跨队列依赖**：`"topicKey:taskId"` 里的 id 是**对方队列的 `seq`**（`parseDepRef` 的 foreign 分支）；只落 `ext_deps_foreign`，`edgesFromTasks` 会跳过，不参与本图拓扑。
- **fail-open**：跨队列解析不到 / 已删 / 已迁走 → 不挡（`foreignBlocked` 只在找到且未完成时挡）。
- **完成口径**：`done` 和 `cancelled` 都算终态（不永久挡后人）；`pending` 才是待领取。未知状态一律不算待领取（正判定）。
- 不能依赖自己；`normalizeBlockBy` 会去重、丢自身、丢非法引用。

## 3. 闸门（blocks_following）

- 语义是「一条 pending 挡住它后面一整片」：读取时判 `EXISTS(同 topic, seq < t.seq, status='pending', blocks_following=1)`。
- 为什么不物化成 `task_deps`：闸门是动态的（之后新加的任务也要被挡），逐对物化需要每次插入扫描并回收边，容易与 deps 语义混淆。
- 闸门节点在引擎里表现为 `kind='control'` / `plugins[].scope='control'` 的屏障节点；`isNodeReady` 对屏障前驱单独判定。

## 4. 引擎写入与投影

- 日常 DAG 写路径必须经 `withTopicMutator`（`writes.js`）：`createTopicEngine` → `store.load/create` → `mutator`，**单一写入口**。
- `repo/snapshot.js` 是 DB 适配：`get/set/has` 与旧 JSON 适配器同接口，但 CAS 在 `BEGIN IMMEDIATE` 事务内完成（过期快照当场拒绝，不再先读后写）。
- `topics.version` 就是 revision：外部直改任务行会 `bumpRevision`（version+1），在途快照必然 CAS 冲突 → fail-open 丢弃；引擎写要求 `snapshot.revision === version + 1`，写回后 `version = revision`。
- 写回任务行口径：
  - 闸门节点 → `blocks_following`；
  - `node.state=success` 且无 completedAt → 补完成时间；
  - `node.state=running` 且尚未领取 → `status=claimed`；
  - 本地边 → 「现有 `blockBy` ∪ 快照边」的并集（**不能洗掉外部直写的依赖**）；闸门推出来的边不写 `blockBy`，由 `blocksFollowing` 表达。
- 改上述任何一条，必须同步改 `core/workflow/project.js`（它是两套适配器共用的投影口径）。

## 5. 新代码必须遵守

1. 单条任务能否领取，只调 `isReadyToClaim` / `findFirstReadyPending`，不要另写拓扑排序。
2. 本地依赖写 `task_deps`（全局 id），跨队列写 `ext_deps_foreign`；不要混存。
3. 做图算法必须加回环与深度保护；禁止裸递归 CTE。
4. 读任务列表默认过滤 `deleted_at IS NULL`；已迁移/软删节点视为不挡（`isAlive`）。
5. 不要绕过 `withTopicMutator` 直接改快照；不要用 `tasks.seq` 重排队列顺序（顺序在 `ext_task_order`）。
6. 改判定/投影后，跑 `pnpm test:unit` 中的 `localtask-dag`、`localtask-cross-dag`、`readiness-consistency`、`workflow-*`。

## 6. 引擎装配与插件

- `createTopicEngine()` 负责装配：`SnapshotStore` + event bus + mutator + scheduler；`engine.js` 通过 `import '../tasktool/plugins/index.js'` 以副作用注册全部 goal 插件，所以不要脱离 `engine.js` 自己 new store/mutator。
- 完成一个任务后 `refreshTopicAfterComplete(topicKey)` 会把主题投影进引擎跑一轮就绪，**fail-open**：主题不存在/引擎故障不挡 `done`。
- 新 goal 插件放 `src/modules/tasktool/plugins/`，注册后同时进入引擎与 `system.bootstrap` 的插件列表；不要在 `core/workflow` 里写具体业务插件。

## 7. 关键文件

- 判定内核：`src/core/workflow/readiness.js`
- 图类型/投影：`src/core/workflow/types.js`、`project.js`
- 引擎与存储：`src/modules/localtask/engine.js`、`store/index.js`、`repo/snapshot.js`
- 日常写入口：`src/modules/localtask/writes.js`
- 任务与依赖读写：`src/modules/localtask/repo/tasks.js`
- 队列顺序/工作流状态：`src/modules/localtask/repo/topics.js`
- 编排面板：`src/web/frontend/page/dag/`、`src/web/frontend/page/dir/dag-editor.jsx`、`src/web/frontend/modules/board/`
