# Changelog

本文件记录对外可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.4.1] - 2026-10-08

### Added

- **待领取任务可在队列里直接编辑**：「实时任务」页的任务队列中，状态为「待领取」
  的任务新增「编辑」按钮，行内内联修改（Ctrl+Enter 保存、Esc 取消），复用既有
  `PATCH /api/sessiontasks/item`（`sessiontask update`）；已领取的任务作为历史不提供
  编辑，仅可删除。

## [0.4.0] - 2026-10-08

### Added

- **清理旧脏数据 `sessiontask prune`**：清理「旧模型迁移来的无目录主题」与
  「空主题」；等待中的主题一律保留，`--all-finished` 可连同已全部领取、无待领
  的主题一起清，`--dry-run` 只报告不改动。CLI 与 HTTP（`POST /api/sessiontasks/prune`）
  同源，「实时任务」页主题总览右上角新增「清理旧数据」按钮。
- **任务队列记录 agent 每一轮的完成总结**：任务被领取（queued 取走或 delivered
  实时回填）时，把它所回应的「agent 上一轮完成总结」记入该任务（`roundSummary`），
  常驻面板与弹窗的队列在任务文本下以「上一轮完成：…」展示，跨轮现状不再被覆盖丢失。

## [0.3.2] - 2026-10-08

### Fixed

- **实时任务弹窗：agent 领取（回填 delivered）后不再显示倒计时**。此前弹窗在
  agent 已取走任务后，状态栏的倒计时仍继续走到 0；现 agent 一旦领取即隐藏整个
  倒计时状态条（倒计时只在「等待回填」时有意义），计时器同步停止。常驻面板主题
  卡本就仅在等待中显示倒计时、领取后显示「已结束」，行为一致。

## [0.3.1] - 2026-10-08

### Changed

- **实时任务（sessiontask）主题改按「工作目录名」识别**：主题 key 取 cwd 的
  目录名（basename，如 `br_ct`）——在该目录执行 CLI 即自动领取对应队列的一条
  任务；同名目录（即使完整路径不同）共用同一队列，不同目录互不串。
- **主题拥有可堆积的任务队列**：同一主题下的回填按队列堆积、逐条领取；现状
  （`--summary`）不再是 key，仅作状态展示。替代 0.3.0「现状总结即等待点 key」
  的 slots 模型，旧数据自动迁移为主题。

### Added

- **阻塞超时支持在 Web 页面配置**：「实时任务」页顶部新增超时选择，默认/推荐
  **180 秒（3 分钟）**、上限 **600 秒（10 分钟）**，超上限自动截断；`wait`
  未带 `--timeout` 时采用该配置。新增 `sessiontask config --timeout <秒>`。
- 放宽单条任务内容与现状长度上限（任务 20000 字、现状 2000 字）。

## [0.3.0] - 2026-10-06

### Added

- **新功能域「实时任务输入」（sessiontask）**：在一个对话里通过工具调用实时向
  agent 回填任务，替代在原始输入框打字。agent 完成当前任务、提交结果后，把
  `nx-kv sessiontask wait --summary "<当前现状总结>" --json` 作为本轮**最后一个
  动作**调用——命令阻塞，自动在本机临时起 http 服务器并打开浏览器弹窗；用户针对
  该现状回填后解除阻塞，把新任务作为工具结果返回给 agent 继续，循环往复。
  - **现状总结即等待点 key**：相同现状（逐字一致，忽略首尾/连续空白）复用同一
    等待点，不同现状分散为不同等待点；用户在面板「等待点总览」看清各现状、点选
    **分别回填（分散答复）**。
  - **阻塞超时默认 120 秒（2 分钟）**：未回填则返回 `{status:"timeout"}`、
    exit 0，agent 据此安静收尾结束本轮；超时是业务结果不是错误。
  - **排队语义**：任务可提前投递；等待点非空时 wait 立即取走、不开窗。
  - **纯本机协调**：数据存本地文件（`~/.nx-kv/sessiontasks.json`），
    不依赖 KV 后端、不需登录；路径可用环境变量 `NX_KV_SESSIONTASK_STORE` 覆盖。
  - CRUD 五操作 `sessiontask list / get / add / update / remove` 两端可达（均按
    `--summary` 定位），面板新增「实时任务」页（等待点总览、点选回填、任务表、删除）。
- **新内置 skill `kv-sessiontask`**：教 agent 四条硬规则——wait 必须在最后一步、
  工具调用超时设 120000ms、wait 必传现状总结作为 key（同现状同句、新现状新句）、
  timeout 即收尾。含完整时序、分散答复与避坑（`references/sessiontask-workflow.md`）。
  安装：`nx-kv skill install kv-sessiontask`；`skill list` 现列出两个 skill。

## [0.2.1] - 2026-09-27

### Added

- **Web 面板图标入库**：favicon（ico + 16/32/48 png）、logo、圆角 logo 现在随包分发，
  `nx-kv serve` 起的面板页签、桌面快捷方式、添加到主屏（apple-touch-icon）都有图标了，
  并新增 `theme-color`（移动端地址栏与图标同色）。
  图标源在 `src/web/frontend/public/`（Vite publicDir，构建时自动拷进产物），
  与 nx-as / nx-rp / nx-sk / nx-nx 同构；不放 `assets/` 是因为那是 skill 安装目录，
  会被 `skill install` 一起装到用户机器。
- **smoke 新增断言**：`/favicon.ico` 必须 200，防止图标再次从产物里丢失。

### Fixed

- `.gitignore` 误把 `src/web/frontend/public/` 当 dev 产物忽略（vite 从不在那里产生东西，
  它是静态源资产的标准位置），导致此前图标从未入库、clone 后构建出无图标面板。

## [0.2.0] - 2026-09-26

### Changed

- **⚠️ 破坏性：单条任务操作改为按「内容」定位，不再接受 id。**
  `todo get / update / remove / done / freeze / unfreeze` 一律改用 `--ref "<内容整串>"`。

  原因是 id 根本不足以定位一条任务：
  1. 分配只扫「待办 + 冻结」，任务完成后 **id 会被复用**（实测 done 有 68 条、其中 id=29 有 7 条）；
  2. 同一主题下内容重复本来就是常态（「修复登录页」这类任务会反复投递）。

  `id` 现在只是**给人看的元数据**：仍然分配、仍然出现在 `--json` 输出里
  （`todo.add` 的返回也保留 `id`，兼容既有调用方），但**不再是任何命令的入参**。

  ```bash
  # 之前
  nx-kv todo done 29 --result "已接入"
  # 现在（内容含空格要加引号）
  nx-kv todo done --ref "把 watchkv 的告警接进来" --result "已接入"
  ```

  消歧方式不变：`--pick <n>` 按编号选、`--topic <名字>` 按主题收窄；
  命中多条时仍然**拒绝猜**。`update` 的消歧旗标是 `--match-topic`。

- **HTTP 路由**：单条操作的路径从 `/api/todo/:id` 等改为固定的 `/api/todo/item`，
  定位内容走 `ref` 参数（中文文本塞进路径段在编码与可读性上都不划算）。
  受影响的端点：`GET/PATCH/DELETE /api/todo/item`、
  `POST /api/todo/done|freeze|unfreeze`。

- **面板**：任务的「同 id 有 N 条」提示改为「同内容×N」；所有按钮改传内容定位。
  对已走 `/api/todo/:id` 的旧客户端不兼容。

- **默认端口 7820 → 7877**。

### Added

- **`--ref` 为空时报 `INVALID_INPUT`**：挡住「忘了传 --ref 却恰好命中一条 `text` 为空
  的坏数据」这种随机改数据的路径。
- **装载期自检**：action 声明里若有 rest 型 flag（吃掉其后全部 token），
  必须排在 `flags` 最后——否则后面的旗标会被静默吞掉。
  *当前未启用 rest flag*（它无法与 `--pick` 组合，而消歧比少打引号重要），
  自检与判定函数留着，供将来启用时不再踩坑。
- **eslint 约束**：`src/modules/todo/**` 禁止用任务 id 拼定位路径。
  只保留这一条语法上说得清的规则——`{ id: nextTaskId(...) }`（分配新 id）、
  `{ task, id: task.id }`（回传）、`#{t.id}`（展示）都与定位无关，
  会误伤的规则比没有规则更糟。

### Fixed

- `locateAll` 改为**整串精确比对**，不做前缀/模糊匹配——「看起来像」不该被当成「就是它」。
- 错误文案不再把 id 当作任务标识（`task id=29 不存在` → `task「旧记录」不存在`），
  改用它真正用来定位的那个键。

## [0.1.0] - 2026-09-16

首个版本。KV 清单（todo）的 CLI + Web 面板，对接 GoFrame KV 后端（默认 `47.110.80.47:8988`）。

### Added

- **清单 CRUD**：`todo list / get / add / update / remove`，覆盖四把 key
  （`todo:open` / `todo:done` / `todo:freeze` / `todo:topics`）。
- **状态流转**：`todo done / freeze / unfreeze`，以及 `todo archive` 把旧完成记录归档到冷 key。
- **主题**：`topic list / add / remove`（带各状态任务数）。
- **主题提示词**：`prompt set / get / remove` —— 存 `todo:prompt:<topic>`，
  让 agent「拿任务即拿上下文」。
- **工作空间完整 CRUD**：`group list / get / add / update / remove`（声明为集合资源，
  五操作齐备且两端可达）+ `group current / use / members`。
  切换只改本机配置；解散有前置条件（组内须无 KV），且**不能解散当前使用中的空间**。
- **面板**：「已完成」列可一键**归档旧记录**（移到 `todo:done:cold:<日期>`）；
  任一列超过 15 条自动折叠，避免历史记录把待办挤出视野。
- **认证**：`auth login / logout / status / me`。token 存 `~/.nx-kv/config.json`，
  密码交互式隐藏输入、**不落盘**。
- **Web 面板**：`nx-kv serve`，三页（清单 / 工作空间 / 登录），无 emoji、单色、
  响应式、状态持久化、路径与标识点击即复制。
- **内置 skill**：`nx-kv skill install` 把 `assets/nx-kv/` 装到 `~/.claude/skills`，
  供 agent 学会用这个 CLI 领任务。
- **自省命令**：`routes`（命令 ↔ 路由对照 + `--http` 反查）、`bootstrap`（一次拿齐上下文）、
  `health`。

### 架构

沿用 server-cli-web 标准骨架：**一条 action 声明同时驱动 CLI、HTTP、面板**，
三端不可能分叉；分层由 eslint `no-restricted-imports` 强制；
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐。

### 安全

- 后端信封是 `{code,message,data}` 且 **HTTP 恒为 200**，成败看 `code` —— 判断收在一处。
- `remove` 等变更操作**按数组下标定位**，不按 id 批量过滤。
- 跨站写请求被 Origin 校验拒绝；静态服务做 resolve 后前缀校验。

### 已知问题

- 历史版本（≤0.1.1）把 `id` 当定位键，而同 id 多条是常态。
  单条操作现已改为按内容定位（见顶部 0.2.0），数据结构本身不变 ——
  既有记录里的 id 照旧保留，只是不再参与定位。
