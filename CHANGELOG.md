# Changelog

本文件记录对外可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.10.0] - 2026-10-20

### Added

- **新增 `timegoal` 模块：把"持续运行 N 小时"任务固化到 nx-kv。** 完全独立的命令族
  / 独立 store / 独立循环链路——**与 localtask wait 没有任何关系**（不调用、不被调用、
  store 也不共享），可以同时跑也可以分开跑。UI 上嵌在「本地任务」主题卡里只是为了查
  看便利（数据/逻辑完全独立——拔掉 localtask 本模块照样跑）。

  - 命令族 `nx-kv timegoal <...>`：
    - **`set`** 新建/替换本目录 timegoal（`--duration 60-86400`、`--prompt "<...>"`），
      重置起点；
    - **`update`** 改提示词，可选**同时改时长**（`--duration`）——**保留起点**
      （`deadline = startedAt + 新时长`，已用时间仍算数）；agent 自我迭代提示词、
      用户 Web 端编辑都用这条，避免一次小改动把整套 3 小时清零；
    - **`show`** 仅查询；**`check`** 时间运算 + **原文回显 prompt**
      （让 agent 永远以 store 为准，避免长对话里漂移），到点返回 `reached:true`；
    - **`clear`** 清空（无则 `no_goal`，面板按钮可无脑调用）；
    - **`list`** 总览所有有 timegoal 的目录。
  - **典型流程**：开头 `set` 一次 → 每轮 `check` 拿 `prompt` 当本轮根指令干活 →
    调研发现 prompt 漏条件就 `update` 替换 → 到 `reached:true` 那轮立刻停手。
  - 独立 store `~/.nx-kv/timegoals.json`（`NX_KV_TIMEGOAL_STORE` 可覆盖），
    与 localtask 的 `localtasks.json` 完全分离——两套循环并行不冲突。
  - **UI 完整编辑入口**（`localtask/view.jsx`，任务看板）：
    - 页面顶部新增「时间目标」汇总卡：列出**所有目录**的 timegoal（含还没在
      看板里出现过的目录——CLI 先设、agent 后 wait），支持**新建**（填目录 +
      时长 + 提示词）、**编辑**（改时长/提示词；默认保留起点，勾「重置起点」
      才从头计）、**清空**；状态列显示 `剩 mm:ss` / `已到点`，每 1.5s 刷新。
    - 主题卡里 timegoal 行**恒显示**：已设置 → 倒计时 + 查看/编辑/清空；
      未设置 → 「未设置时间目标 + 设置」（直接为该目录新建）。
    - 时长输入带快捷按钮（30 分钟 / 1 / 2 / 3 / 8 小时），不用手打秒数。
    - 编辑一律走 `PATCH /api/timegoals`（保留起点）；只有勾「重置起点」才走
      `POST`（= `set`，计时清零）。
  - 模块边界：timegoal service 不读 localtask service；`topicKeyFor / stampNow
    / parseStampMs` 是 4-6 行的纯工具，本地复制避免跨模块耦合；纯函数
    `evalTimegoal(goal, nowMs)` 不读时钟、便于单测钉边界。
  - 单测 `tests/unit/timegoal.test.mjs`：duration / prompt 边界、`evalTimegoal`
    四时段、set → show → check 链路、update 保留起点、不同 cwd 隔离、模拟到点、
    store 损坏容忍、环境变量覆盖、prompt 含换行/Unicode 原样回显。
  - 配套 skill `kv-timegoal`：`nx-kv skill install kv-timegoal`。`SKILL.md` 与
    `references/workflow.md` 强调 timegoal 与 localtask wait 等其它命令族完全独立
    ——skill 文字里不出现"`localtask wait` + `timegoal check`"的搭配示例。

### Fixed

- **短时限等待被秒级截断「吃掉」：`waitingUntil` 只存到秒。** `stampNow` 是**截断**
  不是四舍五入——真实 deadline `S+1.97s` 存成 `"S+1"` 后解析回来是 `S+1.000`，比真实
  时刻早了近 1 秒。等待时长只有 1~2 秒时这点误差能吃掉**整个窗口**：wait 若恰好在
  某秒最后 ~40ms 启动，事件流 100ms 后轮询时判定「不在等待」→ `waiting` 事件永远推
  不出来（`tests/unit/localtask-sse.test.mjs` 由此带 ~4% 的 flake，实测 flake 率与
  40ms/1000ms 的理论值吻合）。
  - **修法**：`setWaiting` 额外写毫秒精度的 `waitingUntilMs`（epoch ms）；判定一律走
    `deadlineMsOf()`（优先毫秒值，老数据回退解析字符串）——`isLiveWaiting` /
    `watchEvents` / 面板倒计时全部改用它。`watchEvents` 判「新一轮等待」也从比较
    秒级字符串改成比较毫秒 deadline（同一秒内开始的两次等待字符串相同，靠它判会漏）。
  - 真实影响：默认 180s 超时下截断误差无感（相对误差太小），但**判据正确性**不应
    依赖时长够长；面板倒计时也不再提前 1 秒归零。
  - 回归测试 4 例：字符串已过期但毫秒值未到 → 仍算等待中；毫秒值也过期 → 不算；
    老数据无 `waitingUntilMs` 回退字符串；真实 wait 写入毫秒值且与字符串同秒。

- **「等待中」永远不结束：僵尸 `waiting` 标志残留。** 面板上某个主题永远显示
  「等待中 已等 760:35 · 剩 0:00」，点「关闭」也没反应。
  - **根因**：`waiting` 标志由 wait 进程写入、结束时在 `finally` 里复位；但 wait
    被**强杀**（SIGKILL / 任务管理器杀 / 终端关掉 / 机器崩了）时 `finally` 不会执行，
    标志就永久留在 store 里。曾实测：gs-ac 的 wait 在 22:29 开始、应在 22:32 超时
    收尾，但进程没了 —— 于是标志卡住，用户 23:14 点「关闭」也**没有活进程**来消费
    `cancelRequested`。
  - **修复**：判定「是否真的在等」统一走新函数 `isLiveWaiting(t)` ——
    `waiting` 为真**且**截止时刻还没过。截止已过 = 那个 wait 本来也该收尾了 =
    没人真在等。此前 `countWaitingTopics()` 与 `watchEvents()` 各有一份内联判断，
    `topicView()` 却只看裸标志，于是面板看到的是假状态。
  - 改动点：`topicView()` 对外把 `waiting` 抹成假值、另给 `staleWaiting` 标记；
    `pruneTopics()` / `removeTopic()` / `removeTopics()` / `cancelWait()` /
    `countWaitingTopics()` 全部改用 `isLiveWaiting`。
  - **连带修好的三处卡死**：僵尸等待的主题过去永远躲过 `prune`（空主题也清不掉）、
    被「等待中不能删」挡住、也阻塞面板空闲自释放。
  - 面板显示改为「**已结束（上次等待超时，进程已退出）**」，如实说明发生了什么，
    而不是让倒计时一直转。
  - 单测 `tests/unit/localtask-stale.test.mjs`（7 例）：`isLiveWaiting` 四个分支 +
    僵尸等待在 list / count / prune / remove / cancel 各路径的表现 + 正常等待不受影响。

- **`localtask wait` 会重复打开多个浏览器窗口**。根因是「有没有活标签」这条判据失效：
  服务端 `panelPresence()` 统计的是 `/api/localtasks/events` 上的活动 SSE 连接，
  但面板页改成 1.5s 轮询后**再也没有建立过 SSE**，presence 恒为 0 ——
  于是每次 wait 都以为没人在看、都开一个新窗口，等待期间还每 20s 再开一个。
  - **面板补上常驻 SSE**（`localtask/view.jsx`）：既是 presence 的信号，也顺手把
    waiting / reminder / resolved 变成即时刷新，轮询退化为兜底。
  - **wait 开窗加三道闸**：初次开页即计入冷却（页面加载到 SSE 连上之间有空窗，
    否则 5s 后第一次复查就会再开一个）；单次探测为 0 不算标签被关，要**连续两次**
    （≈10s）探不到才重开 —— 后台标签被冻结、SSE 自动重连、网络抖动都会短暂掉 0；
    一次 wait 最多开 3 个窗口，避免浏览器拦脚本时刷成窗口风暴。
  - 单测 `tests/unit/localtask-window.test.mjs`：`shouldReopenWindow` 四个分支 +
    `panelPresence` 的连接计数与断开归零。

## [0.9.0] - 2026-10-16

### Added

- **任务附件：正文里用标准 markdown 嵌图片与文档，并可同步到本地给 agent 直接读。**

  - **嵌入语法就是标准 markdown**，不发明新方言（解析实现只有一处：
    `src/modules/todo/attach.js`，Node 与浏览器共用）：
    `![说明](fileId)` 图片（面板内联预览）、`[文件名](fileId)` 其他文件（docx/pdf…）。
    `fileId` 是后端图床的不透明 id（32 位 hex，原文件名带后缀时结尾接 `.<ext>`）。
    **判定刻意收窄**：URL（含 `://`）、站点路径（`/…`）、相对路径（`./…`）一律按
    普通 markdown 原样保留 —— 否则任务里写条普通链接就会被当成附件，
    然后预览 404、同步白跑一趟网络。
  - **新模块 `file`**：`file upload / list / get / remove / content / sync`。
    上传走后端 multipart（`POST /api/v1/files`，字段名 `file`）；`file content` 在
    HTTP 侧把后端出图内容原样透传（面板 `<img src="/api/file/content/<id>">` 用），
    CLI 侧只打印地址与本地路径。
  - **`file sync`：把附件同步到本机** —— 存在的唯一理由是让 agent **读本地文件而不是读网**。
    默认落到 `~/.nx-kv/attachments/<groupId|default>/`（`NX_KV_ATTACHMENTS` 可改根目录），
    同目录 `manifest.json` 记「fileId → 本地文件名 + 大小」，所以二次同步跳过未变更的。
    本地文件名优先取正文里的说明文字（`![设计稿.png](id)` → `设计稿.png`），否则退回
    fileId 并按 Content-Type 补扩展名（没有扩展名，Windows 上双击打不开）。
    `--ids` 只同步指定附件；`--prune` 清理本地已不在后端的（**仅在全量同步时生效**——
    带 `--ids` 再 prune 会把没列出来的附件一起删掉）；`--dryRun` 只列不落盘。
  - **`todo attach` / `todo attachments`**：把附件**追加**到任务正文；列出某条任务
    引用了哪些附件、本地是否已有。`todo attach` 会拒绝不像 fileId 的值（比如 URL）。
    ⚠️ 追加会改写正文，而定位按正文内容（`--ref`）—— 连续操作要用**新的** text。
  - **新模块 `setting` + 面板开关：「读任务时自动下载附件」。**
    `nx-kv setting get` / `nx-kv setting set --autoSyncAttachments[=false]`
    （面板在「清单」页工具栏）。开启后 `todo list` / `todo get` 会同步正文引用的附件，
    给每个任务附加 `attachments[]`（`id / kind / name / localPath / synced`，
    **localPath 是本地绝对路径**），并用 `attachmentsSync` 汇报这一轮
    `downloaded / skipped / failures`。**下载失败不阻断读取** —— 附件拿不到与
    清单读不到是两件事，失败如实进 `failures`，本地已有旧版本时继续用它。
    默认**关**：开启意味着每次 list/get 都触网，对「只想看一眼清单」是纯负担。
  - **`attachments` 标注与开关无关**：关掉开关后不再同步，但「这条任务挂了附件」
    仍会出现在 `attachments[]` 里（`localPath` 反映本地已有则给路径）。
  - 前端：`todo` 的编辑从单行 dialog 换成完整编辑器弹窗（`editor.jsx`）——
    **粘贴（Ctrl+V）/ 拖入 / 选择文件** 三条路都能上传，自动插到光标处、实时预览；
    列表里图片以缩略图内联、其他文件显示为可点附件（`markdown.jsx`）。
    - **Ctrl+V 直接粘截图**是主路径：截图工具不给文件名，`upload.js` 会替它起
      `粘贴图片-<时间戳>.png`（这个名字会一路用下去：正文说明文字 + 落盘文件名，
      退化成 `image.png` 就再也认不出是哪张）。一次粘多张带序号，不重名。
    - 拖拽挂在 **window** 上而不是编辑区上：往弹窗里丢文件、落点差一点也该接住，
      而不是让浏览器把文件打开；只在拖**文件**时介入（拖选中的文字不弹提示）。
    - 批量上传**先收齐再一次性插入** —— 边传边插会跟光标位置打架
      （插入后 DOM 里光标还没更新，第二个附件会算错落点、变成倒序）。
    - 纯文本粘贴不拦截，交给浏览器默认行为插到光标处。
    - 快捷键 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存；字符计数与插入语法提示常驻。
  - 「快速新增」那一栏也能 Ctrl+V 贴图：贴张截图再回车，任务与附件一次成型。
  - 「附件自动下载」做成胶囊开关（面板「清单」页），悬停显示附件会落到哪个目录。
  - `core/fileapi.js`（后端文件客户端，与 kvapi 共用同一套信封判定）、
    `core/attachstore.js`（本地镜像与台账）、`core/config.resolveGroupId`
    （模块间共享的 group 回落规则 —— todo 读 KV 与 file 选分组/本地目录必须同一条，
    否则会出现「任务读 A 组、附件同步 B 组」这种不报错的错位）。
  - 本机服务的请求体上限 4MB → 24MB：面板上传走 base64 JSON（膨胀 ~33%），
    10MB 的图会变成 ~13MB 的请求体。

### Changed

- `core/kvapi.js` 的 `call` 改为导出，供 `core/fileapi.js` 复用（两处各写一遍
  信封判定迟早分叉）。
- `todo list` / `todo get` 的每个任务可能多出 `attachments[]`；开启自动下载时
  顶层多出 `attachmentsSync`。未开启时**没有** `attachmentsSync`，其余字段与旧版一致。

### Tests

- `tests/fake-backend.mjs` 增加文件端点，并**手写 multipart 解析** ——
  用 JSON 假装上传就测不出「boundary 丢了」「字段名写错」。
  假后端刻意**不返回 originalName**，与真实后端一致：本地文件名只能自己解决。
- `tests/smoke.mjs` 新增 25 项：上传（图片/docx）、list/get/remove、content 直出字节、
  嵌入追加、`file sync` 落盘与二次跳过、开关打开后读任务自动下载并回传全路径、
  关掉后不再同步但标注仍在、非法 fileId 被拒。
- `tests/unit/attach.test.mjs` 新增 9 项：嵌入解析的边界（普通链接不许被误判、
  去重保序、说明文字取首次出现、往返一致）。

## [0.8.5] - 2026-10-13

### Added

- **本地任务新增「全局任务池」（跨目录共享队列 + 工作窃取）**，参考 Go 调度器的
  local runq + global runq 两层模型：
  - `wait` 的领取顺序变为：本目录队列 → **全局任务池** → 阻塞。本地取不到时自动
    去全局领，全局也没有才阻塞；**显式传 `--cwd` 不会关闭全局兜底**（防止调用方
    习惯性传 cwd 导致池子无人领取）。返回新增 `source: "local" | "global"` 标明
    任务来源，旧字段全部保留。
  - 发布进池子：`localtask add --global "<任务文本>"`（CLI/HTTP 同名 flag；
    `--global` 时 `--cwd` 被忽略）。不限定接收方、谁闲谁领的任务走这里。
  - 多个 agent 同时阻塞时，全局任务按阻塞先后（FIFO）实时投递给最早等待的；
    跨进程由既有 0.5s 轮询兜底，同样本地优先、全局其次。
  - 全局主题在 `localtask list` 与面板「本地任务」页永远置顶（名称「全局任务」，
    key 固定 `__GLOBAL__`，卡片带「全局」徽章）；面板回填表单新增「全局」勾选，
    选中全局主题卡片时只能推全局。
  - 全局主题默认受保护：`topic remove --key __GLOBAL__` 需 `--force`、
    `topic remove-many` 将其计入 `skipped`（reason `protected`）、`prune` 永不清理；
    它不是等待源——`cancel` 返回 `global_not_waitable`、永不计入等待数。
  - 任务级 `get/update/remove/reorder` 新增 `--key` 寻址（与 `--cwd` 二选一），
    全局主题没有 cwd、只能按 key 管理。

### Fixed

- **落盘并发安全**：`saveStore` 进程内串行化（链式队列）——此前同进程两个写操作
  重叠时共用同一个 `.tmp` 中转文件，先完成的 rename 会把 tmp 消耗掉、后一个
  rename 直接 ENOENT 崩溃（全局唤醒与等待复位并发时必现）；rename 另加 Windows
  EPERM/EACCES 小退避重试（目标文件被并发读者/杀软短暂锁住的瞬态失败）。

## [0.8.4] - 2026-10-12

### Added

- **主题总览加「实时连接」探活指示灯**：1.5s 数据轮询 + EventSource 双心跳，
  主题总览标题旁显示「实时连接正常 / 连接断开，正在重连… / 正在连接…」三态
  （断线用红色语义提示）；轮询失败不再每 1.5s 弹错误 toast，统一由指示灯提示。
- **主题现状 / 上一轮完成总结 / 长任务文本支持点击弹窗阅读**：在原位完整展示基础上，
  叠加点击在居中模态框中专注阅读（长任务文本长度 >50 时才显示可点击指针）；
  支持点遮罩、按 Esc 或「关闭」按钮退出。纯前端交互、无新接口。
- **wait 生命周期事件流（后端 SSE）**：
  - HTTP 为 **SSE** `GET /api/localtasks/events`（可带 `cwd`/`key` 过滤，缺省订阅全部主题，
    首帧 `: connected`、每 15s 心跳、断线自动重连）；CLI 等价为
    `localtask events [--cwd|--key]`，逐行 NDJSON。
  - 事件三类：`waiting`（开始等待，连接时已在等待补发 `replay` 快照）、
    `reminder`（剩余 **30s / 10s** 各提醒一次）、`resolved`（`delivered` 被回填 /
    `timeout` 超时；对等待标志残留的僵死状态补发 `stale:true` 的 timeout）。
  - 后端生成器 `watchEvents` 与传输 `streamEventsSSE` 解耦，单测可独立驱动生成器。
  - `api.js` 增 `action.stream === true` 机制：透传 req/res 给 action.run，
    由 action 自己接管响应（SSE 等长连接用得到）。

## [0.8.3] - 2026-10-12

### Changed

- **wait 统一到常驻主面板（固定端口 7877），彻底移除随机端口临时弹窗**：
  - wait 阻塞时不再在 wait 进程内临时起 http 服务器/弹窗，而是复用 `nx-kv serve` 的
    「本地任务」页：已在运行则直接打开并深链到当前主题
    （`#/localtask?key=<主题>&cwd=<目录>`，前端按 key/cwd 自动选中）；
  - 主面板未运行时，wait 在后台 **detached 自动拉起** `nx-kv serve --no-open
    --auto-exit`（独立常驻进程，健康检查通过后再开浏览器；拉起失败只降级为纯阻塞、
    绝不报错中断）；
  - **主面板页面常驻、提交后不关闭、可连续排队**；wait 拿到任务或超时退出后 serve 依然存活，
    回填统一由约每 0.5 秒的跨进程文件轮询取走（独立进程写入返回 `delivered:false`）；
  - `--no-open` 语义保持：不开浏览器、也不自动拉起 serve，仅阻塞等待（冒烟/CI 依赖）。

### Removed

- 删除随 wait 生命周期起停的随机端口临时弹窗服务器及其内嵌页面
  （`src/modules/localtask/popup.js`），以及与之重复的弹窗专用 HTTP 路由；
  实时任务统一在固定端口常驻主面板完成。
  **行为变更**：不再有「wait 结束即关闭」的临时窗口，也不再输出随机端口地址——
  请改用常驻面板 `http://127.0.0.1:7877/`（wait 会自动打开/拉起）。

## [0.8.2] - 2026-10-12

### Added

- **实时任务 wait 返回任务时自动追加「收尾提醒」（可配置，默认开启）**，防止 agent 在长对话里
  漂移、偶尔忘记最后再 wait 一次：
  - wait 交付任务时在 `task.text` 末尾拼接一段固定提醒（默认大意：规划计划、完成本任务，
    计划的最后一个动作是再次调用 `nx-kv localtask wait` 收尾本轮，拿到下一条或超时前不要提前结束）。
  - 只作用于**返回给 agent 的载荷**，面板/库存里的任务原文保持干净、不被改写；原文已包含同样
    追加语时幂等不重复追加。
  - 可在「本地任务」页配置（编辑、保存、恢复默认、一键关闭），CLI/HTTP：
    `localtask config --suffix "<文案>"`、`--no-suffix` 关闭、`--reset-suffix` 恢复默认
    （HTTP `PATCH` 传 `"suffix": ""` 关闭）；
    `PATCH /api/localtasks/setting` 增 `suffix` 字段，设置视图增 `taskSuffix`/`defaultTaskSuffix`/`suffixEnabled`。

### Fixed

- `loadStore` 重建 settings 时只保留 `timeoutSec`、把 `taskSuffix` 字段丢掉，导致
  第一次 PATCH 关闭后第二次 PATCH 改超时，taskSuffix 会被默认值覆盖（仅 0.8.1 受影响）。

## [0.8.1] - 2026-10-12

### Added

- **常驻面板空闲自释放（serve --auto-exit）**：面板（web）全关且无等待中的主题时，
  serve 进程优雅退出，释放端口——避免后台留一个永远没人看的常驻进程。
  - `nx-kv serve` 新增 `--auto-exit`（配 `--idle <秒>` 调宽限期，默认 120s）。开启后，
    **面板页全部关闭、且没有任何等待中的主题**并持续超过宽限期时，进程优雅退出、释放端口；
    下一次 `localtask wait` 需要时会自动重新拉起（冷启动 <1s）。**用户手动 `nx-kv serve`
    默认不带该标志，面板不会自己跑掉**。
  - 判定「面板是否还开着」用的是任意面板请求的最近时间（SSE 连接数会随切页归 0，
    不能用），为此新增 `GET /api/ping`（纯本机快返回）并在面板壳层每 15s 打一次心跳，
    任意页面停留都算「面板开着」。
  - 两条硬性否决：**有等待中的主题**（agent 正阻塞等人，面板是唯一提醒源）与
    **有活动 SSE 标签**时不释放；`waiting` 标志若已过 `waitingUntil` 截止时刻（wait
    进程被强杀后的残留）不计入，避免残留标志让进程永不释放。
  - 从未有面板客户端连过（无 GUI / 开页失败）时用更长的兜底上限（默认 600s），
    避免与 wait 的「无标签就重开页」互相拉扯出 spawn 抖动。
  - 新增 `src/modules/localtask/panel-guard.js`（纯判定 `shouldAutoExit` + 可注入
    时钟/定时器的看门狗 `startPanelIdleGuard`）与 `countWaitingTopics()`。

- **主题卡「等待中」勋章显示等了多久，并可一键「关闭」这个等待**：
  - 勋章文案由「等待中 m:ss（剩余）」升级为 **`等待中 已等 m:ss · 剩 m:ss`**：
    新增 `waitingSince`（等待起点）落盘——只靠 `waitingUntil`（截止时刻）反推不出起点，
    因为超时上限本身可被改写；旧记录缺该字段时自动退化为只显示剩余。
  - 勋章内新增 **「关闭」按钮**：点确认后**只关等待**——阻塞中的 `wait` 立即收尾并返回
    `{status:"timeout", cancelled:true}`（走与超时同一条出口，agent 侧不必认识新状态，
    照常结束本轮），**不删主题、不删任务、不动队列**。
  - 新增 action `localtask cancel`（CLI `nx-kv localtask cancel --cwd/--key`，
    HTTP `POST /api/localtasks/cancel`）；对「不在等待中」的主题是无操作
    （`{cancelled:false, reason:"not_waiting"}`），不报错。
  - 关闭标记（`cancelRequested`）**只生效一次**：`setWaiting` 在每次等待开始时清掉残留，
    避免「用户点关闭」与「上一轮 wait 收尾」撞车后误杀下一轮等待；wait 端每 0.5s 轮询取走，
    另在等待登记完成后立即复查一次，不让用户白等半秒。

## [0.8.0] - 2026-10-11

### Added

- **新增内置 skill `kv-submit`（提交侧）**：把当前对话总结上下文、提炼出用户需求，
  打包成自包含任务文本，通过 `nx-kv localtask add --cwd "<目标目录>"` 委托给在
  别的目录工作的 agent；含任务文本模板、拆分/排序/跟踪与避坑清单
  （`references/submit-workflow.md`）。
- **新增内置 skill `kv-localget`（领取侧）**：agent 在自己目录里主动领取排给本目录
  的任务（`localtask list` 查看待领取、`wait` 队列非空时立即取走），附单条
  查看/编辑/删除/调序等队列管理。

### Changed

- **⚠️ 破坏性：功能域「实时任务输入」更名为「本地任务」（localtask），阻塞等待（wait）
  只是其中的一个子功能。**
  - CLI 子命令 `nx-kv sessiontask *` → `nx-kv localtask *`（add / list / get / update /
    remove / reorder / config / prune / wait / topic remove / topic remove-many）；
  - HTTP 路由 `/api/sessiontasks*` → `/api/localtasks*`；面板页「实时任务」→「本地任务」，
    弹窗标题与面板内命令示例同步更新；
  - 存储文件 `~/.nx-kv/sessiontasks.json` → `localtasks.json`：新文件缺失时自动读取
    旧文件、首次保存落到新文件（旧文件保留不删），队列数据零丢失；存储路径环境变量
    改名 `NX_KV_LOCALTASK_STORE`，旧名 `NX_KV_SESSIONTASK_STORE` 仍然兼容。
- **内置 skill `kv-sessiontask` 重命名为 `kv-waittask`（等待侧）**：安装名、group 名
  同步改为 `kv-waittask`（`nx-kv skill install kv-waittask`）；CLI 命令名随上一条改。
  已装旧版的用户重新 `skill install kv-waittask` 即可，旧
  `~/.claude/skills/kv-sessiontask/` 目录可手动删除。
- **内置 skill `kv-local` 定名前改名为 `kv-localget`（领取侧）**：随本版首次发布，
  无迁移成本。
- **kv-waittask 文档对齐 v4 队列模型**：现状总结只是状态展示（并记录为被取走任务的
  「本轮完成总结」），不再作为等待点 key；队列按工作目录划分、同目录多次 wait
  共用同一队列，任务按先后领取。工具调用超时建议从 120000ms 修正为 300000ms
  （CLI 默认阻塞 180 秒）。README 同步修正该节。

## [0.7.0] - 2026-10-09

### Added

- **支持删除整个主题与批量删除**：
  - 「实时任务」页主题卡片右下角新增「删除主题」，一次删除该主题及其全部任务；
  - 卡片左上角可勾选（总览标题处支持「全选」），顶部「批量删除 (N)」一键删除多个主题。
  - 新增 CLI/HTTP：
    - `nx-kv sessiontask topic remove --cwd "<目录>"`（或 `--key`）/ `DELETE /api/sessiontasks/topic`；
    - `nx-kv sessiontask topic remove-many --keys "<k,k>"`（也可 `--cwds` 或 `--all`）
      / `POST /api/sessiontasks/topics/remove`。
  - 安全保护：等待中的主题默认不删（避免阻塞的 agent 干等到超时），界面二次确认、
    命令加 `--force` 才连等待中一起删；批量返回 `{count,removed,skipped}`，skipped
    列出被跳过的「等待中 / 不存在」主题。
- 新增删除/批量删除单测与冒烟断言。

## [0.6.0] - 2026-10-08

### Added

- **待领取任务队列支持拖拽重排序优先级**：
  - 「实时任务」页队列的待领取行可按住拖拽（行首 ⠿ 手柄），拖动时半透明、目标行
    显示上/下落点指示线，松开即调整领取顺序；表格反转显示，落点已正确映射到数组真实顺序。
  - 同时提供「提前 / 置后」按钮作为拖拽之外的兜底（窄屏/触屏友好），边界自动禁用。
  - 新增 `nx-kv sessiontask reorder --id <编号> (--beforeId <编号> | --afterId <编号>) [--cwd]`
    与 HTTP `PATCH /api/sessiontasks/reorder`；只在待领取任务之间换位，已领取（历史）任务
    固定不可移动；非法输入（同时给/都不给/移到自己/移动已领取）一律显式报错。
- 新增 reorder 逻辑单测；全套 51 项全绿。

## [0.5.0] - 2026-10-08

### Added

- **skill 命令补齐为完整多 skill 形态（严格按脚手架 B04）**：
  - `nx-kv skill list`：列出包内可装 skill（nx-kv / kv-sessiontask）、默认安装项与可装 group；
  - `nx-kv skill groups`：列出 groups.json 的 group → 其包含的 skill；
  - `nx-kv skill install [name] [--to <dir>] [--force]`：显式装某个 skill；
  - `nx-kv skill install --group=<key> [--to <dir>] [--force]`：一键装整组（`<name>` 与
    `--group` 互斥，同时给报 INVALID_INPUT）；
  - `nx-kv skill get [name] [ref] [--to <dir>]` / `--group=<key>`：输出 skill 全文（prefix +
    sentinel + 正文 + install 状态），供外部 agent 一键拿全上下文。
  - 新增 `assets/groups.json`（默认 group key = nx-kv）；缺失/损坏时降级为目录扫描，
    schema 错显式报错，不静默。
  - HTTP 新增 `GET /api/bundled/groups`、`GET /api/bundled/content`。
- 新增单测 `bundled-multiskill.test.mjs`（20 项断言：三种 install、默认标记、降级、
  schema 错、幂等、部分冲突聚合、get 整组）；全套 50 项全绿。

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
