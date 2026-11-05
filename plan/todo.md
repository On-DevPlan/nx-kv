# nx-kv

## 项目业务

### 语义

一个 kv 清单的任务管理中枢系统。

### 使用流程

用户提交任务后，Agent 基于项目组的上下文方向引导，以 Markdown 文件为交互载体进行任务执行，支持单独配置等待任务与时效目标；任务完成后执行回填并进入等待状态，若用户产生新的修改反馈则在 Markdown 上继续编辑并重新进入执行循环，若无更新则直接结束，形成「执行—等待—反馈修改」的动态闭环。

**对外 skill（已收敛）**

- [x] `kv-get` — 领取 / wait / done / reopen（含 timegoal check 门禁、项目级持续 get）
- [x] `kv-submit` — 提炼需求并 `localtask add` 委托
- [x] `kv-repo` — 项目组关系报告 + clone 外源参考仓库并**强制读**

旧 skill（`kv-localget` / `kv-waittask` / `kv-timegoal` / `kv-repo-mmx-gitrepo`）已并入上述 references，不再单独维护。

**回调定位**

- [x] 领取输出带头 `#<task.id>`；完成 / 重开 / 编辑一律 `--id`，保证回调准确
- 其余（收尾指令模板、持续 get）走项目 / 全局设置

## 项目单元概念

### 项目 vs 项目组

- [x] 项目：绑定仓库，一仓库 = 一个项目
- [x] 项目组：组合关系（看板），无父子层级，具有语义方向性
- [x] 项目 / 组均可绑定 markdown 目录，支持 `[[双链]]`
- [x] 介绍的「补充文档」可带**分类标签**（`--tag`，如 qa）——面板 ＋ ref 新增可选填、每条链接旁 ＃ 可改/可清，渲染成小 chip；docLinks 条目 = DocRef + 注解（note/tag），写入口 / loadStore 归一化 / zip 导出导入三处同一口径（`docref.withLinkMeta`）；同 doc 重复添加 = 更新该条
- [x] 组内每个仓库有独立组内描述（note）——地位、解决问题、与兄弟关联
- [x] CLI 可快速拿到本项目知识（`board list` / `repo knowledge` / `repo ref of`）
- [x] 发布任务指定归属（`--project`，配 `--board` 时必须是该组成员；落点目录由项目推导，`--cwd` 只做一致性校验）；领取按落点目录定位
- [x] 提交携带 frontmatter：`board`/`project` 归属 + `boardIntro`/`projectIntro`（介绍文档**引用式**：路径 + 一行摘要）；改文案（reopen/update `--text`）不丢 frontmatter
- [x] 取/派两条链路同构：派任务编排迁 `tasktool/add.js`（与领取侧 get/wait 并列，action 层一行委托），落点判定只此一份实现——CLI/HTTP/面板提交/远程导入同走一条 `submitTask`；正文自带 frontmatter（fail-open）落点也跟到项目队列（显式 `--cwd` 时不挪窝）
- [x] 领到组内仓库任务时，交付 `instruction` 封装：组概念、组介绍、本项目位置、兄弟角色、参考文件可读路径（`task.text` 保持原文）

### 任务工具

- [x] **timegoal**（任务级）：发布带 `--duration`（CLI）或任务编辑页「时间目标」栏 → 领取即计时 → 提示词要求 `timegoal check` → 未到点 `done` 返回 `blocked`，派 sub agent 重提需求
- [x] **waitgoal**（项目级「持续 get」）：默认直接 get；开启后无任务自动唤起阻塞窗口 + 模板增强「继续 get 直到超时」（模板可多条，与回调提示词同款按条编辑）
- [x] 时间窗口从领取起算；check / 剩余时间 / 提示词模板可配
- [x] 回调提示词可配多条（列表存储，按条增删；拼接后统一分流渲染）：设置面板 →「模板与任务工具」；时长无全局默认（曾有的全局默认时长已删），只在发布/编辑任务时显式给——CLI `--duration` 或面板编辑页「时间目标」栏；**未领取**的任务可在编辑页改/清声明，已领取计时中的冻结（要调先 reopen）
- [x] **任务附件（2026-11-04 #15 定稿口径：本地贴图走本地存储，与云端零关联）**：面板编辑器贴图/选文件与 `localtask attach --path` 都落**本机附件仓**（`~/.nx-kv/attachments/local/`，`core/localatt.js`——不发网、上传即落盘）；正文嵌 `![名](fileId)`（id 与云端 fileId 同构，语法零分叉）；领取标注本机仓优先（命中即绝对路径，全命中零网络），云端清单引用才按设置走镜像同步；`/api/file/content` 本机仓优先（面板预览离线可用）。修掉的现象：旧链路把贴图送上云端图床，云端不可达时界面看着有图、正文只有死引用，agent 领取 `attachments count: 0`

### 导入导出

- [x] 以全局唯一 **key**（归一化远程地址 / 自定义）为身份；仓库组绑 key，不绑本地路径
- [x] 导出 zip：`layout.json` + 自有 docs 树（描述 markdown 一并带走）
- [x] 无 key / 无远程：跳过或标「待完成」；导入端本地没有的成员 →「待初始化」占位
- [x] 仓库统一管理面板：接管 / clone 补齐占位（只要 key 对上即可链接）

> 说明：导出不只是「项目关系」——含仓库条目、看板成员 key、参考关系与自有文档树（v4）。

## UI

### 左右面板 / 侧边栏

- [x] 上侧面板（顶栏）删除；全局动作进侧边栏品牌区
- [x] 设置面板统一收敛到侧边栏齿轮（浮动设置面板）
- [x] 侧边栏拖拽自动收起：宽度 &lt;46px 收起 / ≥120px 展开，中间迟滞带防抖；点击收起/展开直接翻状态

### 任务队列显示

- [x] 显示序：**未完成（待领取）优先**——队列是追加序，新任务会被几十条历史埋底；显示序与队列序分开（`sortTasksForDisplay`，桶内待领取仍按队列原序=领取优先级）
- [x] 队列长度有出口：侧栏任务子行不再硬截断在 12 条（静默丢弃第 13 条起，用户既看不到也够不着），改**分页**（12 条/页）；目录任务表同样分页（20 条/页）+「N 待领取 · M 个任务」计数
- [ ] 后续（用户提出「后续可以尝试」）：队列存储换 SQLite——`~/.nx-kv/localtasks.json` 现在是整份读写，队列一长就整份重写；换库前先做只读镜像比对（同一批任务两种存储逐条对齐）再切换

### 设置面板

- [x] 全局设置进侧边栏浮动面板（偏好 / 工作区 / 云端与存储 / 模板与任务工具 / 项目级）
- [x] 功能性：模板配置入口、任务工具（回调提示词）、项目级「持续 get」
- [x] 项目级设置 UI：icon 入口在标题行左侧圆形预览，点开就地编辑（与侧栏同步显示）

### 提示词 / 模板收敛（2026-11-04 #32）

- [x] **设置面板新增「提示词 / 模板」一栏**：任务模板槽位 + 回调提示词 + ack 完成总结提示词收在一起（此前散在「模板与任务工具」区、模板页、项目级设置三处，编辑器各抄一份）
- [x] **ack 提示词（新增）**：`settings.ackPrompt`（多条，与 taskSuffix 同款语义）——agent 写完成总结的格式要求，随领取交付的 instruction 给到 agent；默认不配置 = 交付逐字不变。CLI：`localtask config --ack`
- [x] **模板槽位**：正文里的 `{{槽位}}` 是槽位，**内置模板骨架锁死**只填槽位（`template update --values`）；新建任务正文按槽位值渲染
- [x] **共享编辑器**（`modules/prompts/`）：文本框 + 占位符插入菜单 + 已用占位符标记——回调 / ack / 持续 get / 模板槽位共用一份

### 弹层组件收敛（2026-11-04 #30）

- [x] **两个唯一出处**：`components/toast/`（ToastProvider / useToast / useGuard）与 `components/popup/`（Modal / useDialog / PopMenu / RowMenu / useDismiss + `.pp-*` 统一视觉）——ui.jsx 只剩 Copyable / ErrorBoundary / DiffPre
- [x] **原生 alert/confirm 全部清零**（12 处、8 文件）：confirm → `useDialog`（danger 红 + 页内键盘可取消），成功/失败提示 → toast；此前 ui.jsx 头注释写着「不用浏览器原生弹窗」却一直有 12 处违规
- [x] **旧弹层外壳收编**：迁移确认框 / 快捷键 sheet / 成员选择器重壳到 Modal；`.dlg`、`.modal`（v1 遮罩 与 v2 盒子两套互斥定义的历史雷）、`.mdw-sheet`、`.gmenu`、`.rowmenu-pop` 样式块删除，Esc/点外关闭统一进 `useDismiss`

## 开发

- [x] 项目级 skill `.claude/skills/dev-nxkv/`：改本仓库代码的施工单——分层地图、模块骨架、action 字段全表、CRUD 契约、注册三步、常见坑与验收命令（README「架构」节有指引）

### 面板优化（2026-11-04 #38-#40）

- [x] 侧栏搜索框降高响应式（#38）：sbox 24px、＋按钮 flex:none、容器查询四档降级（256/195/150/125）、nx-title 折行修复
- [x] 面板 maximize 键全删（#39）：tabSetEnableMaximize=false 一关全断（按钮/右键菜单/双击都走 canMaximize 门控）
- [x] 任务编排进面板（#40）：目录任务表拖动排序（localtask reorder）+ 编排编辑器（闸门/上游/下游，客户端查环）+ 组页按队列作用域的闸门开关与编辑器 + 闸门×N/锁定徽章
- [x] 引擎约束对齐（#40 过程中发现并实证）：闸门不能声明上游（隐含边成环，addEdge 拒 + 投影清 blockBy）；闸门显式后继边被投影按冗余剪除——编辑器 UI 同口径禁用/清空
- [x] 设置面板交互收敛（#41）：左 tab 悬停切换、提示词条目收起成标题行点击才展开、说明文字全删、项目级持续 get「选模板 + %s 一句话」配置
- [x] 顺带修两个存量实缺陷（#41 实测发现）：①首次打开设置面板爆栈（#33 的 FLOAT 区域递归）；②回调/ack 提示词面板保存 400 且静默无效（#32 action 未暴露列表 flag）→ 新增 --suffix-list / --ack-list
- [x] 可视化编排面板（#40 重开后的验收反馈）：目录与组共用，头部右侧绿色超链进右侧 maincontent；节点=小圆角卡片 + 网格画布；拖拽排序 / 左侧把手拉线建有向依赖（blockBy，曲线+箭头）/ 节点设闸门 / 节点加 timegoal；组内可切成员队列
- [x] 组任务面板按反馈精简：只留头部右侧一个绿色「编排」超链，行内绿链与 ⋮ 菜单全删（编排能力集中到编排面板）
- [ ] 后续候选：编排面板的节点自由摆位（参考 nx-pg 的 canvas 引擎，当前只有纵向队列位）；跨队列的组级依赖语义
- [x] 面包屑可见 + 返回键（#42）：FlexLayout 根绝对定位盖住顶部路径条 → 工作区整体下移一条；侧栏页签条下掉（#33 残留）；「← 返回」按来处返回（组→任务→返回→回组），单测口径同步
- [ ] 后续候选：组页跨队列排序（需先有跨队列 DAG 语义）；编排编辑器的下游接线在闸门开启时的「预备线」模式（当前保存时跳过）

- [x] 面包屑移进 maincontent 面板内（#44）：新增 <RouteBreadcrumb/> 挂各主面板根部，路径上下文抽成共享 crumbCtxOf，路由历史抽成 route-history 模块，撤掉「工作区给面包屑让位」的占位 hack

- [x] 设置面板观感重做（#41 重开反馈「ui 太丑了」）：提示词栏改顶部药丸 tab + 限宽内容、轻量条目行、分隔操作条；项目级改紧凑行（密度 2→8 个/屏）、持续 get 关着时只留行内小开关

- [x] 路径条放进 MD 工具栏 mdw-top 内（#44 重开反馈「mdw-top 在这个区域里面」）：标题左侧的一枚药丸，不再单占一行
- [x] 二轮反馈「更丑了」（#41 第三轮）：收起行标题洗成可读短句（promptTitle 剥 {{...}} 与空引号对）、提示词栏去盒中盒、持续 get 行内开关去边框

- [x] 改归属项目即搬家（#43「提交后发现归属项目填错了，重新修改提交无效」）：update/reopen 的 effective frontmatter.project 解析到哪个登记项目，任务迁到哪个队列（与派任务同一套落点判定，编排收进 tasktool/update.js）；自愈「字段改了队列没搬」的历史脏数据。约束：已领取不能改归属；队列内依赖/闸门搬不动如实拒绝；搬家换队列内 id（面板页签自动跟号，CLI 输出标注）；跨队列引用（topicKey:id）改写到新地址；projectIntro/Desc 随归属刷新

### 文档去重与体检（2026-11-05 #46）

- [x] **plan/todo.md 快照追加病根除**：此前每条 `docs:` 提交都是**追加整份文件**而不是改它——
  390 → 783 → 1567 → 3136 → 6274 → 12550 → 25103 行，同一份 56 条清单被复制了 **256 遍**。
  去重后回到 **116 行**（最后一份是前 255 份的严格超集，零内容丢失，逐行比对确认）。
  根因是写入方式而非内容本身——**改文档要改，不要整份追加**。
- [x] **CHANGELOG 两处「。：」拼接疤**：#41 三轮反馈（9e3aa2c）与 #44 重开反馈（7d64c70）
  两条 `docs:` 提交同样是追加，导致同一条目正文重复两遍、中间留下 `。：` 断句。已删重复段。
- [x] **CHANGELOG 0.20.0 分区归位**：该版本因多次追加攒出 Added×2 / Changed×3 / Fixed×2，
  且顺序是 Changed→Changed→Fixed→Changed→Added→Fixed（乱序）。按 Keep a Changelog
  归并为 Added / Changed / Fixed 各一段，条目一条不丢。

### 遗留（非本批引入）

- [ ] `src/modules/localtask/index.js` **812 行**，超项目 800 行硬上限。增长发生在 DAG 面板
  特性提交（72fb1bc，779→812），**不是** T1–T6 重构引入的——action 声明 + render 函数
  混在一个文件里，等有新动作时值得再拆一层。

### T1–T6 重构评审发现（2026-11-05 #46 代码评审，**未修，待排期**）

T1/T4/T5 的核心断言**已复核属实**（store 隔离端到端实测通过、就绪内核两个入口确实共用
`isNodeReady`、`isGateNode` 并集口径与现状等价）。但评审出 4 条真实问题，都在**语义层**，
不在本轮「工具区检查」范围内，逐条留档：

- [ ] **就绪判定语义变化（与「行为零变化」的说法冲突）**：`core/workflow/readiness.js` 的
  `isReadyToClaim` 现在经 `taskToNode` 映射 `completedAt → state:'success'`，而
  `isNodeReady` 对 success 直接返回 false——**「有 completedAt 但 status≠consumed」的任务
  从此不可领**（旧口径只看 `status!=='consumed`，会把它再派一遍）。旧行为是重复劳动，
  新行为更安全，但确实变了，且 `tests/unit/readiness-consistency.test.mjs` 的期望值是**从
  新实现反推的**（同义反复），钉不住这个场景。**待办**：给一致性测试补一条
  「completedAt + pending」的固定期望，把语义钉死。
- [ ] **字符串 `blockBy` 导致两个模型分叉**（同上一条根因，同一批）：
  `core/workflow/types.js` 的 `edgesFromTasks` 只认**数组** `t.blockBy`，而
  `readiness.js` 的 `rowsGraph` 先过 `normalizeBlockBy`（能解析逗号串）。于是
  `blockBy:'1'` 时：任务行口径 = **不可领**，快照口径 = **可领**（`edges=[]`）——
  T4 承诺的「两个模型必然一致」在此**不成立**。复现：
  `isReadyToClaim(#2)=false` 但 `isNodeReady(topicToSnapshot(...),#2)=true`。
  写路径（CLI/HTTP）都过 `normalizeBlockBy`，所以是**存量脏数据**才会踩到。
  **待办**：`edgesFromTasks` 内部也过一遍 `normalizeBlockBy`（注意 `types.js` ← `readiness.js`
  的循环依赖，可能要下沉到 `src/shared/`）。
- [ ] **`isGateNode` 并集口径让 `assertBind` 变严**：并集把「任意 control-scope 插件」都算
  闸门（`core/workflow/types.js`）。`mutator/validate.js` 的 `assertBind` 原本只查
  `node.kind==='control'`，现在查 `isGateNode(node)`——一个 `kind:'task'` 却带着
  blockgoal 插件的节点，再绑 taskgoal 会被拒（`control node may only bind control-scope
  plugins`）。今天只有 blockgoal 是 control-scope，故**尚未触发**；但 DAG 面板能注入任意
  plugins 数组，一旦有第二个 control 插件就会撞上。**待办**：`assertBind` 单独用
  `kind==='control'` 判定（它问的是「这是不是闸门节点」，与「闸门插件」是两回事）。
- [ ] **wait 的 ticker 在 `setWaiting` 抛错时会泄漏**（`tasktool/wait.js`）：`timer` 与
  `ticker` 在 `try` 之前创建，中间的 `await setWaiting(...)` 一旦 reject，两者都不被清理
  ——**孤儿 ticker 每 500ms 调一次 `consumeFirstPending`，静默吃掉排队任务且无人接收**。
  旧代码是三个 interval，同样漏，但 T3 收敛 ticker 时正是该把 `try` 上提的时机。
  **待办**：把定时器创建移进 `try`，或用 `finally` 兜住。

### 任务页 ack 定位轨（2026-11-05 #48）

- [x] **一轮一个节点**：反复 ack 反馈的任务页（正文一轮轮变长）右侧挂一条定位轨，
  点一下跳到该轮的「上一轮完成总结」。复用简介页 `.doc-rail` 的视觉，**定位方式不同**：
  按**块序号**跳而非标题锚点。
  - 不用标题 id 的原因：实时预览态**逐块渲染**，每块各有一套标题 id 生成器，同名标题在
    DOM 里拿到**重复的同一个 id**（两个「## 上一轮完成总结」同 id）→ 按 id 跳永远落第一轮。
    块序号（`data-i`）才唯一。阅读态整篇渲染、无块元素，改按「第 N 个 ack 标题」定位。
  - 轮次从**正文**抽（`modules/board/ack-nodes.js`，切块口径直接复用 `liveBodyBlocks`
    ——与实时预览渲染同一函数，序号才对得上 DOM 的 data-i）。正文即历史，正文变了轨跟着变。
  - 只有一轮时不显示（没有可跳的多轮，挂了也是噪音）。
- [x] 验收：Playwright 探针实测（隔离 store + 临时端口 7879）——实时预览态点第 3/1/2 个
  节点分别落到第 3/1/2 轮（视口内可见的正是对应 MARKER 块），active 节点随滚动跟随；
  阅读态点第 2 个节点落到第 2 轮；展开面板列出各轮可点；全程零 console error。
  单测 `tests/unit/ack-nodes.test.mjs` 8 条（抽取口径 + 块序号与 DOM 对齐 + 标题生成）。

### 定位轨可拖动（2026-11-05 #55）

- [x] **汉堡钮当拖把，整条轨拖到容器内任意位置**（Pointer Events，>4px 算拖、否则算
  点击），双击回默认钉位；落点存 localStorage 重开还在。拖后 click 被吃（不误触展开）。
  - 钳制必须用**自然高**：钉位态轨盒子被 `top/bottom` 双锚拉满（高 760），直接拿它钳
    会把第一次拖动错钳到容器顶部（y≤132）——beginDrag 时临时解除底锚量一次自然高
    再恢复（同帧同步，子元素本来堆顶部，无视觉跳动）。
  - 落点存盘用**拖动会话的最终落点**（`d.last`）：`pointerup` 时 React 状态可能未提交，
    读 state 会存回拖动前旧位置，等于白拖。
  - 落点纯逻辑独立成 `modules/board/ack-rail-pos.js`（钳制 + localStorage 存取），
    单测 `tests/unit/ack-rail-pos.test.mjs` 6 条（钳制边界 + 存取往返 + 脏数据容忍）。
- [x] 验收：Playwright 探针（隔离 store + 临时端口 7879 + 本机 Chrome）11 条断言全过
  ——界内跟手、越界钳制（落点矩形完全在容器内）、拖完即持久化、拖后 click 不误触、
  点击展开、展开态拖动、重开还原落点、双击回默认位、探针 store 隔离完好、零 console error。
  探针实测揪出并修掉两个真 bug：endDrag 存未提交 state（白拖）；拉伸盒高错钳首拖落点。

### 进程面板支持项目组（2026-11-05 #56）

- [x] **组发布的任务按组聚合显示**：进程面板原来锁定单个目录，组任务散在各成员项目
  队列里 → 看不见全景。现在组页有「进程」入口（按组聚合：扫全部队列收
  `frontmatter.board` 指向本组的任务，与组页任务面板同口径），任务页工具栏「进程」
  按任务自身语义分流（带 `board` → 按组；不带 → 仍按目录，现状不回归）。
  卡片标题旁标归属项目，非组任务不混入。
- [x] **按项目筛选**：面板顶部 chips（「全部」+ 各成员项目，带计数），点击过滤
  进程卡，顶部统计随筛选范围联动；筛选是会话内状态，切组自动回落「全部」。
- [x] **跨队列批量删除**：删除 API 按目录寻址 → 组模式按任务**所在队列**分桶逐桶
  提交；勾选键用 `topicKey:id` 复合键（不同队列的同号任务不互相顶掉）。
- [x] 验收：Playwright 探针（隔离 store + 临时端口 7879 + 本机 Chrome）8 条断言全过
  ——组页入口、组聚合卡片数与项目 tag、筛选 chips 与联动、跨队列批量删除落库
  （服务端复核软删数）、非组任务回归目录模式、组任务按组打开、零 console error。
  探针揪出一个真 bug：勾选过滤仍用裸任务 id（组模式 picked 存的是复合键）→ 过滤恒空，
  「删除所选」静默不执行。
