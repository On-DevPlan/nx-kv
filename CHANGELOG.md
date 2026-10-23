# Changelog

本文件记录对外可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.11.1] - 2026-10-23 单个项目目录也能从远程导入 + 面板导入 ref/refs 键修复

### Added

- **每个项目目录单独也能从远程导入**。目录看板的每一行操作列现在都有「导入」按钮
  （全局池行同样有），点开就是同一个子弹窗：按主题筛选 + 单条勾选，导入落点是
  **这一行的目录队列**——不用先点开它的队列再导。

### Fixed

- **【面板上点「导入」什么也没发生】**。action 只读 `ctx.ref`（CLI 的 `--ref` flag 名），
  而面板 body 发的是 `refs`；HTTP body 里未声明的键会原样透传，于是 `ctx.ref` 是
  undefined → 后端报「要导入的远程任务不能为空」，面板**静默导了 0 条**。
  现在 `ref` 与 `refs` 两个键都收（合并逻辑抽成纯函数 `mergeImportRefs()`，可单测）。

## [0.11.0] - 2026-10-23 远程任务导入 + 仓库上下文迁入 + 面板视觉收敛

### Added

- **【本地任务支持从远程清单导入】**。远程 KV 清单上还没人领的任务，现在可以**勾几条
  搬进本机的任务队列**，让本机 agent 领得到：
  - 面板的**全局任务池行**与**队列面板**各一个「从远程导入」入口 → **子弹窗**：
    顶部按**主题**筛选（默认全部未完成），每条一个**勾选框**（默认不勾，用户自己安排），
    底部「导入 N 条」。
  - CLI：`nx-kv localtask import-remote --ref "<远程任务内容整串>" [--topic] [--pick] [--cwd | --global]`。
    按**内容**定位远程那条（不按 id —— 远程 id 会被复用）。
  - **导入完成即回填远程**：那条远程任务被标记为已完成，note 写明
    「已导入到本地队列「<队列名>」（本地 #<id>）」，本地给出提示
    「本地的某一个队列领取了这个任务」。
  - 顺序刻意是**先落本地、再标远程完成**：反过来一旦本地写失败，任务两头都没了。
  - 依赖边界：远程通道在 todo 模块（另一个 store + 登录态），这里用动态 import +
    fail-soft —— 没登录/远程不可达会明说原因，但**不牵连本地任务的其它功能**。
- **【仓库上下文模块】**（从 nx-rh 整体迁来，远程清单 topic=goal 的 #72）：
  仓库登记（name/path/tags/desc/notes）与看板聚合（仓库 ↔ 看板，有序）搬进 nx-kv，
  存在 `~/.nx-kv/repos.json`（`NX_KV_REPOS_STORE` 可覆盖），命令是
  `nx-kv repo ...` / `nx-kv board ...`，面板多一个「仓库」页。
  - **它的用途是给本地任务当上下文**：目录路径对得上已登记仓库时，
    主题视图与 `localtask wait` 的返回里都带上仓库信息（名字/标签/描述/**所属看板**），
    面板上目录行显示一枚「所属看板」chip，投递条上方显示该目录的仓库上下文。
  - nx-rh 侧的仓库模块（命令、面板页、store 字段、registry 注册、system 总览）**已删除**，
    数据先迁走（`~/.nx-rh/store.json.bak-before-kv-migration` 留了备份）。
  - 仓库路径是**本机事实**，所以落本地 store，不上远程 KV（跨机器会看到不存在的路径）。
- **timegoal 的时长按人话说**：`--duration` 现在接受 `5h` / `90m` / `2d` / `5小时` /
  `1.5h` 这类带单位的写法（纯秒数 `10800` 照旧可用），CLI 与 HTTP 两端一致。
  上限从 **24 小时放宽到 365 天**——"跑一晚上""连续优化几天"是真实需求，
  24 小时的老上限逼着用户改代码而不是改配置。
- **`timegoal log`**：回看本目录每一轮 check 的记录（现状 / 完成度 / 剩余时间）。
- **`evalTimegoal` / `check` 新增 `overtimeSec`**：到点后报出「已经超时多久」，
  面板上显示「已到点 · 超时 2:13:45」，不再是一句静止的"已到点"。

### Changed

- **timegoal 到点即失效**：目标过了截止时刻就**自动失效**——从活动列表/看板/面板里消失，
  不再越堆越多（以前要手动点一次「回收已到点」）。保留期内 `show` / `check` 仍查得到，
  agent 最后一轮照样拿到 `reached:true` + 提示词原文，能写完最终总结再停手；
  超过保留期（默认 7 天）**整条自动删掉**，不需要任何人手动清理。
  失效的目标**不可复活**（`update` 不再能救回来，要继续请用 `set` 开新一局）。
  `timegoal prune` 仍是「彻底清除到点/已归档的目标」的手动出口。
  （早期版本是"保留期后只丢日志、提示词永久保留"——那条已被推翻，见下面「超时了就自动失效」。）
- **每个 timegoal 的检查日志只保留最近 200 条**：长跑任务每轮都记，不封顶的话
  store 会无限膨胀。`totalChecks` 记总轮次、`logTruncated` 标记历史被截断——
  **截断是可见的**，不会静默丢历史。
- **面板时间目标编辑器改成「数值 + 单位」**（分钟/小时/天），快捷预设补上「5 小时」，
  去掉 24 小时的输入上限。

### 视觉

「本地任务」页做了一整轮重做（方向：**工业仪表盘**——暖中性纸面、1px 发丝线、
机器数据一律等宽、单一墨色主操作 + 三个语义色，状态只靠色点和数字）。
一批问题都是**实测出来**的，不是凭感觉：

- **看板三列等宽**：CSS 里写的 40% / 18% / 19% **根本没生效**——`table-layout: fixed`
  只认 `thead th`，而这几个规则写在 `td` 上，于是 972px 被三列平分。
  现状被压成省略号，操作列白占 196px。类名挂到 `th` 上后列宽立刻生效。
- **看板行高 93px**（GitLab 的 1.5 倍、Trello 的 2 倍），一屏只看得到 5 个目录。
  目录格从 4 段（名/路径/现状/提交说明）压成 2 行：路径并进名称行且只留末两段、
  祖先目录变暗，提交说明并进现状行。行高降到 **56px**。
- **逾期的时间目标渲染成灰色「未设置」**：`.board-goal-label.reached` 实测渲染数为 0
  （读时自动归档已经把到期目标移出活动列表了）。现在行内是琥珀色的
  「已到点 · 超时 2:46:07」，逾期是信息，不是背景噪音。
- **同一列里两种时钟格式**：`剩余 5:47` 和 `剩余 1:05:47` 并排，"5:47" 是 5 分还是
  5 小时？统一成 `h:mm:ss`。
- **队列表的「删除」按钮被卡片边切掉**：操作列给了 156px，四个按钮实际要 190px，
  最后一个永远点不着。列宽改到 196px，并给外层加横向滚动兜底。
- **同一页两张表是两种表格语言**：看板表头有浅灰底 + 发丝线，队列表头透明无线，
  像两个产品。队列表头对齐看板。
- **「投递到」那一行同一句话说了三遍**（下拉旁的说明 + 长占位符 + 按钮文案），
  而且长占位符会被误读成"禁用态"。合成一条输入组：
  `[目标 ▾ | 任务标题，Enter 提交 | 发布到全局池]`。
- **归档区那张大白卡把版面拦腰截断**（占 130px），折成一行
  「▸ 已到点自动归档 (2)　彻底清除」。
- 每行加一条 **2px 状态导轨**（等待中=绿、等待已结束=琥珀、选中=墨色），
  一列对齐的色条比一排填充色块省力得多。
- 徽标从 999px 药丸改成 4px 描边 chip；卡片阴影从 `0 10px 28px` 大模糊改成 1px 发丝环；
  行内按钮常态透明度从 0.5 抬到 0.7（0.5 看着像 disabled）。
- **顶栏**：原来写死了两个「nx-kv」（纯重复），第二个改成版本号；右侧那格读的是
  `boot.storePath` —— 而 bootstrap 响应里**根本没有这个字段**，所以它永远是空的，
  改成显示真实的本地配置路径。
- 目标编辑器的控件原来写的是**内联 style**，把统一表单样式盖掉了，全部改成 class。

### Changed

- **【时间目标到点自动取消】**。以前 wait 只认两种结束：拿到任务，或自己的超时
  （最长 10 分钟）。但如果这个目录挂着**时间目标**，预算到点这一局就该结束了 ——
  agent 等的是"下一条任务"，预算用完了就不该在预算外继续空等。现在 wait 会在
  **等待期间**越过目标截止时刻时立刻收尾，走与超时同一条出口
  （`status:"timeout"` + `cancelled:true` + `reason:"goal_expired"`），
  agent 侧不必认识新状态。CLI 会明说「时间目标已到点，本局预算用完」。
  - 探针来自 timegoal 模块（独立 store），**动态 import**、**fail-open**：
    读不到 / 没有目标 / 加载失败一律当作"没有截止时刻"，wait 照原样走超时，
    探针坏了绝不能把 wait 卡死。
  - **只认"等待开始时还在跑"的目标**：早就过期的目标不参与自动取消 ——
    否则一个用完预算的目录会永远等不了（每次 wait 都秒回），那不是"到点取消"，
    是把目录焊死了。这种情况该由 agent 自己的 `timegoal check`（`reached:true`）处理。
- **【不再显示超时多少】**。到点的目标以前在看板和归档区显示「已到点 · 超时 2:46:07」
  这样**还在走的超时计时器**——一个已经结束的倒计时摆在眼前只会让人盯着它。
  顺带把「已到点」也一起去掉了（见下条）：**到点即失效，面板上不再显示**。
- **【超时了就自动失效】**。到点的目标现在**到点即失效**：
  - 面板上**彻底消失**——看板行的时间目标格留空（不是「已到点」，也不是谎称「未设置」，
    失效与"从没设过"是两件事），「已到点自动归档」区整个删掉，悬停有说明。
    一个已经结束的目标不该继续占着界面。
  - **不可复活**：`timegoal update` 不再能把已到点的目标救回来（到期就是失效），
    要继续这个目录的工作请用 `timegoal set` 开新一局（起点从现在重算）。
  - **到期自动清**：超过保留期（默认 7 天，`NX_KV_TIMEGOAL_RETENTION_SEC` 可调）
    后**整条删掉**（连提示词原文一起），**不需要任何人再去点「彻底清除」**。
    实际落盘点是下一轮 `timegoal check`（或 set/update/clear）——读路径刻意不写盘，
    避免面板每 1.5s 轮询覆写整个文件、冲掉并发的 CLI 写入。
  - ⚠️ **契约变更**：早期版本在保留期后**只丢日志、提示词永久保留**（防的是
    "机器关机一周回来，agent 最后一轮 check 读不到根指令"）。现在改成整条删掉，
    也就是**到期即自动失效**。保留期内（默认 7 天）提示词仍读得到，agent 最后一轮
    收尾不受影响；想留更久就把 `NX_KV_TIMEGOAL_RETENTION_SEC` 调大。
- **队列里记录「发布 → 被领取」的时间差**。任务本来就有 `createdAt` / `consumedAt`，
  现在服务端把它算成派生字段 `pickupSec`（还没被领的是 `null`——那是"还在等"），
  面板上：
  - 待领取表显示「已等 27 小时 02 分」（发布至今，面板每 1.5s 刷一次）；
  - 已领取历史显示「等 1 分 43 秒 被领」（实际差值），和原有的领取审计
    （来自哪个池 / 被谁领走）放在一起——这条任务在队列里躺了多久，一眼可见。
  - 格式带单位（"4分31秒" / "1小时02分"），**不用** `m:ss` —— 之前踩过：
    紧凑时钟用在时长上会被读成"5:47 是 5 分还是 5 小时"。

### Fixed

- **【面板上「这个任务我删不掉」】**。软删除的任务**仍然留在「待领取」表里**：
  视图只按 `status` 过滤、没排除 `deletedAt`，于是点了删除行纹丝不动（`deletedAt`
  又被设成同一个值），再点也没反应。服务端派发本来就按 `!deletedAt` 过滤
  （不会把删掉的任务发给 agent），**只有面板这一层是错的** —— 现在两边口径一致：
  删掉的任务从「待领取」「已领取」两处消失，只在「已删除」区里可恢复/彻底清除。
  拆分口径抽到 `board.js` 的 `splitQueueTasks()`，单测钉住。
- **队列计数把软删除的行算成了「已领」**：面板用 `total - pending` 算已领，
  而 `total` 含软删除的行（全局池 35-4=31，实际已领 30、已删 1）。改用
  `active.consumed`，并把「已删 N」单列出来。
- **【本地任务页在浏览器里整页报错——`<CliHints is not defined>`】**。`localtask/view.jsx`
  用了 `<CliHints>` 却从来没 import 它，整个「本地任务」页一直倒在错误边界上，
  点开就是"这个面板出错了"。一行 import 修好。
- **全局任务池：空池子也能加任务、历史也看得见**。以前全局主题只有真的往池子里
  投过任务才会出现在看板上——池子空着的时候用户**找不到往全局池加第一条任务的
  入口**；而且全局行没有「任务」按钮，全局池的队列根本打不开，已领取的历史也看不到。
  现在目录看板**恒有一行「全局任务」**（视图层合成占位，不写 store），全局行的队列
  可以直接打开，待领取与已领取的历史都列在表里。
- **提交逻辑不再有"静默投错池子"的中间态**。以前「选中目录」+「勾了全局」两个状态
  各管一半，切目录时勾选还留着，任务会静默投进全局池。现在只有**一个投递目标**
  ——工具栏的「投递到」下拉（全局任务池 / 各目录），改哪儿任务就投哪儿，
  提交区还会明写这一条投给谁、谁能领。
- **队列历史不再淹没"还有几条没人领"**。以前所有任务平铺一张表，历史一多就淹没了
  待领取的那几条。现在队列表拆成两段：**待领取**默认展开，**已领取历史**折叠在下面
  （可展开复盘，含上一轮完成总结），表头也分开显示「待领取 N · 已领取 M · 共 K 条」。
- **面板的待领取队列改成按"领取顺序"排**（与 CLI 的 `#1 -> #2 -> #3` 一致）。以前面板
  做了倒序，于是**最上面那一行其实最后才被领**，点「提前」把某行提到前面、屏幕上它
  反而下移——看着像坏了，其实顺序反了。
- **任务删除变成可恢复的软删除**。删除前是最容易让人后悔的一步，而"恢复"只要一条命令：
  `nx-kv localtask task restore --id <编号>`（HTTP `POST /api/localtasks/tasks/restore`）。
  被删的任务仍留在队列里（带 `deletedAt`），面板上有「已删除（N 条，可恢复）」折叠区。
  软删除的任务**不会被 wait 领走**，编号也不会被复用。
- **删目录队列时，若还有未领取的任务会默认拒绝**（报错里带上条数，`--force` 仍可强删）。
  参考 Kanboard 的泳道保护：队列里还堆着没人领的活，不能一声不吭地清空。
  批量删除新增跳过原因 `has_pending`。
- **领取审计**：任务记下 `claimedFrom`（local/global 池）与 `claimedBy`/`claimedByName`
  （谁领的）。全局池里的任务被别的目录的 agent 领走时，事后能看出"这条是谁干的"。
- **看板每行分开显示「待领取 / 已领取 / 已删除」计数**。
- **`localtask reorder` 连字符写法也认**：`--before-id` / `--after-id` 之前 help 里写着、
  实际一敲就报「未知参数」——文档与实现对不上，用户第一次用就踩。现在两种拼法都可用。
- **wait 打开的深链能落到正确的页面并选中队列**。`#/localtask?key=…&cwd=…` 之前因为
  前端拿整条 hash（含 query）去比对视图 id，必然对不上 → 弹窗停在不相干的页面、
  也选不中任何主题。现在剥掉 query 再比对，并按 key/cwd 选中并展开对应队列。
- **CLI `localtask events` 不再必崩**：以前那条命令只做 SSE，直接摸 `ctx.__raw.req`——
  而 `__raw` 只在 HTTP 传输下注入，CLI 进程里是 undefined，跑一次就崩。现在按传输
  分流：HTTP 走 SSE，**CLI 走逐行 NDJSON**（一行一个事件，Ctrl+C 结束）。
- **CLI `localtask presence` 现在真能报数**：SSE 连接只存在于 `serve` 进程里，
  CLI 查自己的进程内计数**恒为 0**（这条命令形同虚设）。现在 CLI 去问常驻主面板，
  返回值带 `source` 标明数据来自哪儿（`panel` / `self`）。
- **`--cwd` 与 `--key` 指向不同主题时直接报错**。以前静默以 key 为准——改错一个 key
  就动到了别的目录的队列，没人会发现。两者指向同一主题时（脚本常见写法）照常工作。
- **「现状」拆成两个字段**：agent 的当前现状（`summary`）与提交方留下的补充说明
  （`submitSummary`）不再抢同一个字段。以前谁后写谁覆盖，面板上的现状会乱跳。
- **面板首屏还没拿到数据时把话说清楚**（"正在连接本机服务…"），别让用户以为面板坏了。
- **切回浏览器标签时立刻刷新看板**（`visibilitychange` → 重新拉数据）。浏览器会把后台标签的
  定时器节流（实测节流到 ~60s，更久还会冻结页面），1.5s 的轮询可能停摆很久——
  用户切回来看到的应该是**当下**的队列，而不是几分钟前的快照。
- **正在用的面板不会再被自动释放**。`serve --auto-exit` 的空闲看门狗要靠"最后一次面板
  活动"判断，但活动钩子一直是空函数 → 空闲时长其实从**进程启动**算起，用户正用着面板
  也会在 10 分钟后被杀掉。现在每个面板请求都会上报活动。
- **`localtask events` 可以划边界了**：新增 `--timeout <秒>`（最长监听多久）与
  `--limit <条>`（最多输出几条），agent 不必再靠 Ctrl+C 掐断长连（对标
  `gh run watch --exit-status`）。两个 flag 都是新增，不给就是原来的无限流。
- **面板的超时下拉不再空白**：CLI 接受 1-600 任意秒数（`--timeout 90`），但下拉只有
  6 档，值不在档位里时浏览器会显示**空白下拉**，看着像没设置。现在当前值会补成一项。
- **看板的目录计数不再把全局池算成目录**（"N 个目录 + 全局池"），与 CLI `list` 的口径对齐。
- **presence 现在看得见所有面板**。以前只问默认端口（7877）上的那一个：`serve --port`
  或端口被占自动顺延出来的面板完全看不见 → wait 以为"没人开着面板"而多开一个窗口。
  现在 `serve` 起来时把自己登记进 `~/.nx-kv/panels.json`（**不是 store，不碰 schema**），
  presence 逐个探测所有端口再求和，探不到的登记顺手清掉。
- **presence 还多报一个 `panelActive`**：SSE 只挂在「本地任务」页，用户切到别的页 SSE 就断了，
  面板明明开着却报 0。现在用「最近有没有面板请求」（App 壳每 15s 打一次 `/api/ping`）兜底。
- **`localtask add --global --cwd <目录>` 不再静默忽略目录**：照旧按 `--global` 优先，
  但返回值带 `ignoredCwd`，CLI 会明说"你给的 --cwd 未生效，任务进了全局池"
  （gh/kubectl 遇到矛盾参数会直接报错；这里为不打断既有脚本选择"照做 + 明说"）。
- **四条删除路径现在共用同一套判定**（`deleteGuard`）：全局共享池 / 等待中 / 有未领取
  任务 → 都要 `--force`。以前「删主题」「批量删除」「prune」各写各的保护规则，
  同一个动作在 CLI 与面板上表现不一致，看着像乱。CLI 命令与路由**一个没动**，
  只是规则收敛到一处（prune 保留它原有的"只清旧脏数据"语义）。
- **SSE 帧加固**：带 `retry: 3000` 与单调 `id:`，浏览器断线重连能据此续传
  （对齐 opencode 的 SSE 加固做法）；另加 `X-Accel-Buffering: no`，避免代理缓冲。
- **软删除的任务可以彻底清掉**：`localtask remove --id <编号> --purge`（面板「已删除」区
  也有「彻底清除」按钮）。默认仍是可恢复的软删除，`--purge` 才是终态。

### Fixed

- **【视觉】面板整体重做：从"通用后台模板"改成"仪表盘"**。原来是一套无差别的
  黑白灰 + system-ui + 软阴影，标题、路径、计数、状态全是同一个字号层级，看起来像
  模板而不像工具。现在：
  - **机器数据一律等宽字体**（路径 / 编号 / 计数 / 倒计时），人读文字用无衬线，
    标签用 Windows 自带的 Bahnschrift（DIN 风格窄体）——面板必须离线，所以不引任何
    网络字体。
  - **状态用色点 + 文字**，不再是一排填充色块（那是最"廉价后台"的做法）；
    有 agent 在等 = 绿点、等待中 = 琥珀点、全局池 = 墨点。
  - **列标题变成仪表刻度**：小字号、加字距、全大写（拉丁文；**汉字不加字距**——
    汉字加 letter-spacing 会把每个字撑开，像排版事故）。
  - **数字用等宽字形**（tabular-nums），刷新时计数不抖；待领/已领/已删三个数分别加重。
  - **行内操作默认半透明**，hover / 选中 / 聚焦时全亮——把"操作"从视觉噪音里挪出去。
  - **队列表列宽写死**（以前没列宽，操作列把正文压到十几像素，正文竖着排成一根）。
  - **空状态是设计过的**（虚线圆点 + 主副文案），不是"表没了"。
  - 顶栏 tab 从分段胶囊改成下划线式（工具感），全局池徽章从实心黑改成描边徽章。
  - 选中行用左侧一条实心标记 + 极浅底色（比整行高亮克制）。
  - 活着的指示灯会呼吸（尊重 prefers-reduced-motion）。
- **【视觉】清单页（默认首屏）在窄面板里不再把每条备注压成一根竖线**：
  三个桶（待办/已完成/冻结）在放不下时改为**竖排**（≤900px），备注最多两行。
  以前在侧边栏宽度下，一条「后端 GET /api/v1/user/default-group…」的备注会
  竖着排十几行——整屏没法扫。
- **草稿串目标**：为 A 目标写的文字，切到 B 目标后还留在输入框里，用户一点提交就把
  **旧草稿投进了新队列**（"这条本来要投给全局池"结果进了 nx-kv）。现在换投递目标时
  清空草稿 —— 宁可少一次编辑，也不要投错。
- **新装的面板没有输入框**：工具栏已经写着投递目标，却找不到 composer（选择器的当前值
  就是目标 → 不触发 change → 面板不开）。现在队列面板**默认打开**，一进来就能写。
- **到点的时间目标在看板行里显示「未设置」**：归档区明明写着"已到点"，行里却说像从没
  设过。现在行里显示「已到点（见归档区）」。
- **看板行按最近更新排序**：任意一次领取都让整张表重排，行在光标底下跳走。改为按
  目录名排序（全局池仍置顶）。
- **「投递到」下拉与它控制的输入框隔着一整张表**（归档卡还可能楔在中间）：下拉移到
  输入框旁边。
- **文案里漏出 markdown 星号**（面板上直接显示 `按**目录名**认队列`）→ 去掉。
- **「超时 1:26」被读成 1 小时 26 分**（紧凑时钟用在了超时时长上）→ 改成人话时长。
- **「空闲」这个标签没有解释**（它说的是"没有 agent 在等"，却挨着待领数）→ 加 tooltip。
- **归档区承诺「仍可查提示词与日志」却没有日志入口** → 补「日志」按钮（走 timegoal log）。
- **队列的路径显示会被同名目录覆盖**（队列按目录名识别，路径却"最后写入者赢"）：
  现在**第一个路径为准**（稳定），所有用过的路径记进 `cwds`，面板可如实展示。
- **`wait` 结果把轮询捡走的任务说成「实时回填」**：现在按 `delivered` 判，不再按
  `queued` 反推（跨进程轮询捡走的那条其实来自队列）。
- **测试偶发失败**（等待中相关的用例用固定 sleep 60ms，机器一忙就漏）：改成轮询到
  状态真的出现为止，连跑两遍稳定 168/168。
- **前端终于有"未定义即报错"的护栏**：全局 `no-undef` 是关掉的（浏览器/Node 全局混用），
  于是「用了没 import 的组件 / hook / 变量」只能靠运行时暴露——真实踩过三次，
  每次都是**整页崩**（`CliHints is not defined`、`useMemo is not defined`、
  `dialog is not defined`），而 lint 与单测全都放行。现在**前端单独开 `no-undef`**
  （显式列出浏览器 + ES 全局表），并补了一条 `tests/unit/frontend-refs.test.mjs`：
  扫描所有 .jsx，断言用到的组件与 React hook 都有来源。
- **timegoal 的 `getTimegoalLog` 之前只有测试没有实现**（`timegoal log` 命令一并补上）。
- **timegoal 列表不再吐每个目标的完整提示词**：归档区 N 个目标就是 N×20KB，
  而面板每 1.5s 拉一次 list。列表只给一小段预览，完整原文用 `timegoal show --cwd`
  按目录取（面板的「查看提示词 / 编辑目标」改为按需单取）。
- **timegoal 的读路径不再写盘**：`list` / `show` 原本会触发整文件覆写，而写盘只在
  单进程内串行——面板每 1.5s 拉一次 list，和并发的 CLI `check` 存在互相覆盖的风险。
  归档状态可从 deadline 推导，不需要读时落盘；只有真正写的路径才写。

## [0.10.1] - 2026-10-20

### Changed

- **端口被占用时不再报错退出：自动复用或顺延，并把浏览器指过去**。`serve` 绑定端口
  遇到 `EADDRINUSE` 时，先探测该端口上的 `/api/bootstrap`：占用者**就是本项目的面板**
  （`app.name` 相同）就直接复用它——不再起第二个进程——并打开浏览器指向它；占用者是
  别的服务（或探测不出来）则顺延到**下一个空闲端口**起自己的面板，并打开浏览器指向新
  面板，不会把浏览器指向别人的服务。
- **跨项目统一的关闭开关 `NX_SERVE_NO_OPEN`**：设成 `1` / `true` / `yes` / `on` 时
  `serve` 完全不开浏览器（所有 nx-xx 项目共用这一个变量名）；`--no-open` 仍然只关
  当前这一次。

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
