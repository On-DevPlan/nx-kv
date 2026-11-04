# DAG 体系 —— 任务顺序、依赖与编排引擎

> 配套 [[dev-nxkv]]。凡动 `core/workflow/**`、`modules/localtask` 的依赖/闸门路径、
> `modules/tasktool/plugins`（goal 族）、或前端编排面板（`page/dag`、`page/dir/dag-editor`、
> `page/group` 拖排序），先读本文——这里的语义跨多层，改一处不看全局极易破口径。

## 心智模型：两层结构，任务行是真相源

```
localtasks.json 主题桶（任务行）          ← 存盘形状 = 真相源
  task.blockBy / blocksFollowing / status / completedAt / timegoal
        │ topicToSnapshot()                ↑ applySnapshotToTopic()
        ▼                                  │ （回写；foreign 边保留）
WorkflowSnapshot（core/workflow/types.js） ← 引擎视图，不是第二条真相源
  nodes / edges / workflowPlugins / revision
```

- **现网领取（get/wait）走任务行模型** `isReadyToClaim`——引擎 scheduler 只做
  快照内 pending⇄ready 投影，不决定谁能被领。
- 快照由 Mutator 唯一写入口维护，CAS（revision）防撕裂，原子整覆盖无增量 patch。

## 目录地图

| 位置 | 文件 | 职责 |
| --- | --- | --- |
| `core/workflow/` | `types.js` | 冻结契约：WfNode/WfEdge/WorkflowSnapshot/PluginSpec；`taskToNode`、`edgesFromTasks` |
| | `readiness.js` | 就绪判定**两条入口**（任务行 + 快照节点）；blockBy 解析（local/foreign） |
| | `project.js` | 投影对：`topicToSnapshot` / `applySnapshotToTopic`（回写保留跨队列边） |
| | `edges.js` | 前驱/后继查询（predecessorsOf/successorsOf） |
| | `lifecycle.js` | 冻结的 workflow/node 相位与插件钩子链约束 |
| | `plugin-registry.js` | goal 名/scope 元数据登记与校验 |
| | `layout.js` | 目录规范（禁平行顶层；goal 唯一落点 GOAL_HOMES） |
| `modules/localtask/` | `dag.js` | **纯再导出 shim**（readiness 下沉的过渡），别往里加逻辑 |
| | `engine.js` | `createTopicEngine`（store+bus+mutator+scheduler）；`refreshTopicAfterComplete` |
| | `store/` | SnapshotStore（create/load/saveAtomic CAS）；topic-adapter 动态 import service 断静态环 |
| | `mutator/` | **唯一快照写入口** + 校验（自环/环/绑定规则） |
| | `scheduler/` | 听 `dag:mutated` → driveReadyStates（pending⇄ready） |
| | `writes.js` | 日常 DAG 写路径（add/update/complete → Mutator → 投影回写） |
| | `service.js` | 业务真相：领取/交付/updateTask 的依赖判定（带 foreignResolver） |
| `modules/tasktool/` | `plugins/` | goal 族唯一落点：blockgoal/waitgoal/timegoal/taskgoal |
| | `facade/`、`wait.js` | submit/get/wait 门面；wait 轮询调 consumeFirstPending |
| 前端 | `page/dag/index.jsx` | 画布编排面板（目录/组双模式） |
| | `page/dir/dag-editor.jsx` | 目录页模态编辑器（闸门+上游+下游勾选） |
| | `page/group/index.jsx` | 组任务行拖排序（限同成员队列） |

## 顺序的四种表达（核心语义）

| 机制 | 字段/API | 语义 |
| --- | --- | --- |
| 队列序 | `tasks` 数组序；`PATCH /api/localtasks/reorder` | 默认顺序；reorder 在 pending 子序列内移动 |
| 显式依赖 | `task.blockBy`（本地数字 id） | B 等 A：A `completedAt` 前领不了 B |
| 闸门 | `task.blocksFollowing`（--gate） | 挡住**数组序在我之后**的全部 pending，直到自身 completedAt（隐含边，不写进 blockBy） |
| 跨队列依赖 | `task.blockBy` 里的 `"topicKey:id"` | 组编排边：别的队列的任务完成后本条才可领；对 get 生效 |

闸门语义**依赖数组序**——所以 reorder 与闸门不是两套独立机制；编排画布刻意不提供
reorder（拖节点只改摆位），顺序关系只有连线。

## blockBy 解析（`readiness.js`）

- `parseDepRef`：`number>0` → local；`"key:id"`（key 为 `[A-Za-z0-9_-]+`，含
  `__GLOBAL__`）→ foreign；纯数字字符串 → local（避免 `"12"` 被当 foreign）。
- `normalizeBlockBy(raw, selfId)`：逗号串 / 数组 / 混写通吃；去重（local 与 foreign
  分开命名空间）；丢本地自身；非法项静默丢弃。
- **foreign fail-open**：`opts.resolveForeign` 缺席、解析不到主题/任务、任务已删/已迁
  → 一律不挡（与「依赖缺失」同口径）。没有解析器时跨队列依赖永远放行。

## 就绪判定两条入口

| 入口 | 函数 | 判什么 |
| --- | --- | --- |
| 任务行 | `isReadyToClaim(task, all, {resolveForeign})` | blockBy 全部 `completedAt` + 数组序在前的闸门全部完成 |
| 任务行 | `findFirstReadyPending(tasks, opts)` | 按数组序取第一条可领 pending（consumeFirstPending 用） |
| 快照节点 | `isNodeReady(snap, node, isBarrierOpen)` | 入边前驱全 success；control/blockgoal 前驱看屏障（`isBarrierOpen`=节点 success） |

**三处调用点都必须传 `resolveForeign`**（service.js 的 `normalizeTask` ready 徽标 /
`consumeFirstPending` / `addTask` 的 `canDeliver`）——漏一处，跨队列依赖就在那条路径
上静默放行。改依赖判定先 `grep -n "isReadyToClaim\|findFirstReadyPending" src`。

## 投影（`project.js`）—— 最容易破的地方

- `topicToSnapshot`：`taskToNode` 映射状态（`completedAt`→success、`consumed`→running、
  `ready===true`→ready）；`blocksFollowing`→kind=control + blockgoal 插件；timegoal→插件。
  `edgesFromTasks` 产边：本地数字 blockBy 边 + **闸门隐含边**（gate→数组序其后全部 alive）。
  **foreign 边（含 `:`）被跳过**。
- `applySnapshotToTopic`：入边→blockBy，但**跳过 from 是闸门的边**（由 blocksFollowing
  覆盖，避免重复表达）；**keepForeign——回写时从旧任务行保留全部 foreign 依赖**。
- 不变式：改 `edgesFromTasks` / `applySnapshotToTopic` 任何一侧，必跑
  `tests/unit/localtask-dag.test.mjs` 的投影测试（「投影回写保留跨队列 blockBy」）。

## 引擎装配与约束

- `createTopicEngine` = SnapshotStore(topic-adapter) + bus + mutator + scheduler；
  topic-adapter **动态 import** service（store↔service 断静态环），快照存取即主题桶投影。
- **Mutator 是唯一快照写入口**：load → structuredClone draft → fn → saveAtomic(CAS) →
  emit `dag:mutated`。绕过它直接改快照 = 破坏 CAS 与事件链。
  - `addEdge`：禁自环；`wouldCreateCycle`（**加 u→v 成环 ⟺ v⇝u**，DFS from to 找 from）；重复边幂等。
  - `bindPlugin`：onBind 规范化 config；**control scope 插件把 node.kind 升级成 control**
    （普通任务打 --gate 走这条路）；workflow 级 timegoal 至多绑一个。
- Scheduler：听 `dag:mutated`（debounce 10ms）→ `driveReadyStates`：isNodeReady→pending
  升 ready；屏障回来了 ready **退回 pending**（动态加挡）。**永不调用 onGet、不自动进
  running**（running 由领取侧推进，taskToNode 把 consumed 映射成 running）。
- lifecycle 链约束（`lifecycle.js`，冻结）：调度链禁 onGet；消费链只读 ctx 禁写快照。

## 写路径（谁在什么时候动 DAG）

| 时机 | 代码链路 | 动作 |
| --- | --- | --- |
| 入队 | `service.addTask` → `writes.syncNewTaskDag` | ensureNode + 闸门 bind blockgoal + **本地边** addEdge |
| 改依赖/闸门 | `service.updateTask` → `writes.syncTaskDagUpdate` | bind/unbind blockgoal；拆全部入边（保留闸门边）重接本地边 |
| 完成 | `service.completeTask` → `writes.markTaskSuccess` + `engine.refreshTopicAfterComplete` | 节点 success + 跑一轮调度（fail-open，不挡 complete） |
| 领取 | `wait.js` 轮询 → `service.consumeFirstPending` | 纯任务行操作，不动快照 |
| 排序 | `service.reorderTasks` | 纯数组序移动；闸门「挡后续」随之重算 |

日常写必须走 `withTopicMutator`（writes.js）——它现 load 现写，**别缓存 snapshot 再写**
（CAS 会炸）。闸门不能声明上游：快照里 gate→后续隐含边与「上游→闸门」成环，mutator
拒绝且投影回写会清掉 blockBy——UI 与其对齐（dag-editor 开闸门即清空禁用上游段）。

## goal 插件族（`tasktool/plugins/`）

| goal | scope | 挂在哪 |
| --- | --- | --- |
| blockgoal | control | 调度屏障（`isBarrierOpen`=节点 success）；scheduler onSchedule |
| waitgoal | node | get 阻塞窗口（getLoop 的长轮询）；消费链 onGet |
| timegoal | workflow/node | 领取即计时，未到点不许标完成 |
| taskgoal | node | 任务级附加 goal |

- 四个 goal **同一目录、每种一份**（`layout.js` GOAL_HOMES 硬规范，禁拆 core 一份 modules 一份）。
- `plugin-registry.js` 登记 name/scope；`assertPluginSpec` 校验 scope 违规即抛。
- 新增 goal：`definePlugin` + `plugins/index.js` 目录扫描自动注册（IoC，加载即注册）。

## 跨队列依赖（组编排边）

- 格式 `"topicKey:id"`；topicKey = `normalizeCwd(cwd).key`（16 位 hash）或 `__GLOBAL__`。
- **只存在于任务行**：`edgesFromTasks` 跳过、`applySnapshotToTopic` keepForeign 保留、
  `writes.js` 的 `localDepIds` 只把本地 id 写进引擎。
- 解析：`foreignResolver(store)`（deleted/migrated → null → fail-open）。
- **服务端没有跨队列环检测**——引擎环检测只覆盖单 topic 图；画布面板在可见节点图上做
  客户端 DFS 检测（口径与 mutator 一致：加 u→v 成环 ⟺ v⇝u）。
- 端到端保障：`tests/unit/localtask-cross-dag.test.mjs`（B 被挡 → instant get timeout →
  A 完成 → B 可领）。

## 前端编排（三处入口，语义各管一段）

| 入口 | 语义 |
| --- | --- |
| `page/dag/index.jsx` 画布面板 | **有向连线是唯一顺序关系**；拖节点只改摆位（不 reorder）；未连线走队列默认序。目录模式（dirKey=topic key）与组模式（groupId，按任务正文 frontmatter.board 过滤成员队列全部任务 + 队列筛选 chip）。连线：右侧出端口点一下进连线态或按住拖到目标；Esc/点空白取消；环检测在可见图。跨项目连线落盘 `"topicKey:id"`。PATCH 的 blockBy 发逗号串（`applySpec` 强转 + `normalizeBlockBy` 数组也兼容） |
| `page/dir/dag-editor.jsx` 模态编辑器 | 目录任务行内编排：闸门开关 + 上游勾选（我的 blockBy）+ 下游勾选（对方的 blockBy）；环判定用「未保存的本任务 ups + 其他人服务端 blockBy」合成图；保存 = 逐条 PATCH |
| `page/group/index.jsx` 组任务行 | 待领取保持各成员队列序，HTML5 拖拽**仅限同一成员队列**落点（reorder API 按 topic）；跨项目提示改用编排连线。已领取按 consumedAt 倒序 |

面板细节：dag 面板在 `panels.jsx` 登记（config `{dirKey, groupId}`），`workspace/areas.js`
归 `AREA.MAIN`。打开任务用 `openPage({ dirKey: node.topicKey })`——page 面板按
`rows.find(r => r.key === dirKey)` 解析，**必须传 topic key**，不是 repo key。
任务 scope：全局队列发 `{ key }`，其余发 `{ cwd }`（`topicIsGlobal` 判）。

## 检查单（改 DAG 相关代码时）

1. 单测：`node --test tests/unit/localtask-dag.test.mjs tests/unit/localtask-cross-dag.test.mjs`；提交前 `pnpm test` 全量。
2. 动 blockBy 格式/解析 → readiness 单测 + 投影测试 + cross-dag 集成三处都要绿。
3. 动依赖判定的调用点 → 三处 ready 调用（徽标/领取/交付）一起核对 resolveForeign。
4. 动 CLI 口径（`--block-by` 等 flag 的 hint/summary）→ 按 SKILL.md「assets/」一节同步
   用户侧文档（注意：现网 `localtask add/update` 的 `--block-by` hint 还只写了
   「逗号分隔 id」，未提 `"topicKey:id"`——改口径时一并补）。
5. 前端改动真跑 `node bin/cli.mjs serve` + 浏览器点一遍（改样式后清缓存）。

## 常见坑（都在代码注释或测试里钉过）

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| 跨队列依赖被抹掉 / 不生效 | 走了引擎边，或投影回写没保留 | foreign 只落任务行；keepForeign 有测试守，别删 |
| 改了 A 路径的依赖判定，B 路径不挡 | ready 调用点漏传 resolveForeign（fail-open 静默放行） | grep isReadyToClaim 全量核对 |
| 闸门还能设上游 / 设了又消失 | 引擎拒（隐含边成环）且回写清 blockBy | UI 对齐：开闸门即禁上游 |
| `mutator.addEdge` 抛 cycle | 加 u→v 成环 ⟺ v⇝u | 先拆反向路径再加边 |
| `CAS_CONFLICT` / 快照改不动 | 缓存了旧 revision | 用 withTopicMutator 现取现写 |
| scheduler 不跑 | 没 emit `dag:mutated` 或没 `start()`；测试环境直接 `runOnce` | 引擎 close() 会停订阅 |
| 面板连线落盘成 `NaN` / 落错队列 | PATCH scope 带错（全局队列要 `{key}` 不是 `{cwd}`）或 id 没转数字 | patchNode 统一走 `topicIsGlobal` 分支 |
| 组页拖不动排序 | reorder 按 topic，跨成员队列被拦 | 提示用户用编排连线（跨队列走 blockBy） |
