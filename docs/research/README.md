# nx-kv 研究与审计存档

这轮 5 小时持续优化里，四个 subagent 的调研产物与它们各自推动的改动对照。
**结论先落地，报告留档**——每条结论都能指到具体代码改动，而不是停在建议。

## 报告清单

| 报告 | 位置 | 方法 |
| --- | --- | --- |
| 结构审计（只读代码） | `LOCALTASK-STRUCTURE-AUDIT.md`（本目录） | 通读 `src/modules/localtask/*`、`src/runtime/*`，逐条给 `file:line` |
| 任务生命周期调研 | `.tool/research/TASK-LIFECYCLE-RESEARCH.md` | clone kanboard / focalboard / asynq，读一手源码；`gh search code` 补 gh / kubectl / cline / codex |
| TTL 到期语义调研 | `TIMEGOAL-EXPIRY-RESEARCH.md`（仓库根） | `mmx search` + `web_fetch`：K8s TTL controller、DynamoDB TTL、SQS visibility timeout、Notion 回收站 |
| 真实 Chrome 复核 + 队列 UX 调研 | `.tool/r3/ROUND3-REPORT.md` | browser-harness（真实 Chrome，CDP）跑首屏/后台标签实验；`gh api` 读源码 |
| 浏览器 UX 审计 | `.tool/audit/UX-AUDIT.md` | browser-harness 走 8 条用户旅程，40 张截图 |
| 顶级看板 UI 规范调研 | `VISUAL-SPEC.md`（本目录） | 真实 Chrome 逐站量 Trello / GitHub Issues / GitLab Work Items / Plane / WeKan / Kanboard 的 token |
| 本面板视觉审计 | `VISUAL-CRITIQUE.md`（本目录） | 独立 headless Chrome + CDP，锁 1280×900 与 700×900，逐项 `getComputedStyle` 实测 |

### 视觉轮的成品截图

| 文件 | 内容 |
| --- | --- |
| `shots/board-1440.png` | 1440×980：4 目录 + 全局池 + 队列 + 折叠区，一屏读完 |
| `shots/board-700.png` | 700×900 窄屏：投递条竖排、状态文字截断不压列 |
| `shots/board-empty-store.png` | 空 store 首次使用：全局池行在、投递条直接可用、设计过的空状态 |
| `shots/board-header.png` | 顶栏：品牌 + 版本号，右侧是真实的本地配置路径 |

> `.tool/` 是 scratch 目录（`.gitignore` 里有），不入库；根目录的
> `TIMEGOAL-EXPIRY-RESEARCH.md` 与本目录的文档是可入库的。

## 视觉轮的两份报告（用户明说"优化这么久还是不好看"之后）

前八轮全在修**行为**，没修**视觉**——这是真问题。两份 subagent 报告各自从资源出发，
一份去量别人家的真 token，一份来量我们自己的实况，结论互相印证：

| 报告的核心结论 | 落地 |
| --- | --- |
| **CSS 里的列宽是死代码**：`table-layout: fixed` 只认 `thead th`，而 40%/18%/19% 写在 `td` 上 → 实测三列各 324px（均分） | 类名挂到 `th` 上（`board-directory` / `board-task-state` / `board-goal-state`），列宽立刻生效 |
| **一行 93px，是 GitLab 64px 的 1.5 倍**——密度是差距主因，不是圆角阴影 | 目录格从 4 段（名/路径/现状/提交说明）压成 2 行：路径并进名称行且只留末两段、祖先目录变暗；提交说明并进现状行 |
| **逾期目标渲染成灰色「未设置」**：`.board-goal-label.reached` 实测渲染数为 **0**（读时 autoRecycle 已把到期目标移进归档） | 归档目标在行里改用琥珀色 `.reached`，显示「已到点 · 超时 2:40:51」 |
| **同一列两种时钟**：`剩余 5:47` 与 `剩余 1:05:47` 并排，"5:47" 是 5 分还是 5 小时？ | `fmtClock` 统一成 `h:mm:ss` |
| **队列表「操作」列溢出 34px**，`删除` 按钮被卡片边切掉（实测 scrollWidth 190 > clientWidth 156） | `.c-ops` 156 → 196px，外层加 `overflow-x: auto` 兜底 |
| **同一页两张表是两种表格语言**（看板表头有底色+发丝线，队列表头透明无线） | 队列表头对齐看板表头样式 |
| **归档区那张大白卡把版面拦腰截断**（占 130px） | 折成一行 `<details>`：「▸ 已到点自动归档 (2)　彻底清除」 |
| **「投递到」那一行同一句话说了三遍**（下拉旁的说明 + 长占位符 + 按钮文案） | 合成一条 `.compose-bar` 输入组：`[目标 ▾ | 任务标题，Enter 提交 | 发布到全局池]` |
| **行内按钮常态 0.5 透明度，和真 disabled（0.4）分不清** | 常态抬到 0.7 |
| **`.tag` 是 999px 药丸**（GitHub Issues 那种"组件库 demo"味） | 改成 4px 半径描边 chip |
| **卡片挂 0 10px 28px 的大模糊影**（WeKan/Trello 的"卡片汤"就是这么来的） | 改 1px 发丝环（照抄 Trello `--ds-shadow-raised`） |
| **每行一条 2px 状态导轨**（WeKan minicard 的做法） | 按 `data-state` 换色：等待中=绿、等待已结束=琥珀、全局池=墨灰、选中=墨色 |
| 看板行首列是**空格子**，看着像忘了画 | 给表头补一个真的「全选」复选框（批量删除也多一个入口） |
| 页面内容少时下半屏一大片空白 | `#root` 撑满视口 + `main: flex:1`，页脚落到底部 |
| 目标编辑器的控件写的是**内联 style**（`padding:'5px 8px'`），把统一样式盖掉 | 全部改成 class（`.goal-form` / `.goal-dur-input` / `.goal-prompt` …） |

## 每条结论去了哪

### 结构审计（3 个 P0 + 12 个 P1）

| 发现 | 落地 |
| --- | --- |
| P0 面板整页报错：`view.jsx` 用 `<CliHints>` 却没 import | 补 import（HEAD 上就有的 bug，「本地任务」页一直打不开） |
| P0 面板待领取队列倒序 → 最上面那行最后才被领，点「提前」反而下移 | 改为按领取顺序渲染，与 CLI 的 `#1 -> #2 -> #3` 一致 |
| P0 wait 深链 `#/localtask?key=…` 因 hash 匹配没剥 query 而落不到页面、选不中主题 | `App.jsx` 剥 query；视图侧按 key/cwd 选中并展开队列 |
| P1 面板文案谎称「只有在该目录跑的 agent 领得到」（队列实际按**目录名**哈希） | 改成实话，并给路径加提示：同名目录共用同一队列 |
| P1 CLI `localtask events` 必崩（只做 SSE，直接摸只在 HTTP 下注入的 `ctx.__raw`） | 按传输分流：HTTP 走 SSE，CLI 走逐行 NDJSON |
| P1 CLI `localtask presence` 恒为 0（SSE 连接只在 serve 进程里） | 改为问常驻主面板（并逐个端口探测求和） |
| P1 `--key` 与 `--cwd` 同给时静默以 key 为准 | 指向不同主题直接报错（两者一致时照常工作） |
| P1 「现状」两个写入者抢同一字段 | 拆成 agent 现状 `summary` + 提交说明 `submitSummary` |
| P1 `serve --auto-exit` 的活动钩子是空函数 → 空闲从进程启动算起，正在用的面板 10 分钟后被杀 | 接上 `noteActivity()` |
| P2 删除语义四套（删任务/删主题/批量/prune 各有各的规则） | 收敛成 `deleteGuard`（CLI 命令与路由一个没动） |
| P2 面板超时下拉只有 6 档，CLI 设 `--timeout 90` 时下拉空白 | 当前值补成一项 |
| P2 面板把全局池算成目录，CLI 不算 | 改成「N 个目录 + 全局池」，两边口径对齐 |

### 任务生命周期调研

- **Focalboard**（`blocks.go:380/438/453`）：软删除 = 把行搬进影子历史表，恢复 = 从历史表插回；
  Notion 回收站 30 天后硬删；**Kanboard 根本没有软删**（`TaskModel::remove()` 直接硬删）。
  → 采纳「行留在原地 + `deletedAt` 标记 + restore 命令」的最小形态，不做整套回收站 UI。
- **Kanboard 泳道保护**（`SwimlaneModel.php:343`）：队列里还有任务就不许删，模型层拒绝，
  web 与 API 都覆盖（它的列保护只在 API 层，web 路径仍是破坏性的——这正是要避开的坑）。
  → 我们的 `deleteGuard` 同样放在 service 层，CLI 与面板一起被拦。
- **TTL 应当"可算不可存"**（Kanboard 的 overdue 是计算谓词，不存标志位）。
  → timegoal 的归档状态从 deadline 推导，不新增状态字段。

### TTL 到期语义调研

- **K8s TTL-after-finished**：Job 结束后 TTL 秒才"eligible for cascading removal"，
  窗口内对象与其 status/logs 完全可读。
- **DynamoDB TTL**：过期 item 仍可读可改，要自己用 filter 过滤；后台几天内才真删。
- **SQS visibility timeout**：消费方崩了消息会重新可见。
  → 采纳「到点仍可读」的形状。**并且揪出我自己设计里的一个缺陷**：保留期一过就把整条
  （连 prompt 一起）删掉，等于静默切断 agent 最后一轮读根指令的契约 → 改成**只丢日志、
  提示词原文永久保留**。
- **GitHub Actions** 的 `timeout-minutes` 默认 360：有平台级天花板但工具不该照抄。
  → 我们的时长上限从 24 小时放宽到 365 天。

> **2026-10-22 契约反转（用户明确选择"面板层失效 + 到期自动清"）**：
> 上面那条「提示词原文永久保留」**已被推翻** —— 到点的目标现在**到点即失效**：
> 面板上彻底消失、不可被 `update` 复活、超过保留期（默认 7 天）**整条删掉**（连提示词）。
> 调研结论本身没错（"到点仍可读"的那段仍然成立，保留期内 agent 最后一轮照常读得到根指令），
> 被推翻的是**保留期之后**的处理：从「只丢日志、提示词永久留」改成「整条自动失效」。
> 理由是用户要的是"不用再手动点彻底清除"。保留期可用 `NX_KV_TIMEGOAL_RETENTION_SEC` 调大。

### 真实 Chrome 复核

**推翻了我自己的一个假设**：我以为「面板首屏停在连接中」是产品缺陷，真实 Chrome 实测
**不复现**——隐藏标签下第一次 `/api/localtasks` 只要 10-14ms，看板 ~1s 内就渲染好。
那个现象是**内嵌 Electron 浏览器**特有的（它冻结后台标签）。真实 Chrome 只在 >5min 后
节流定时器（实测 59s 间隔），看板会变陈旧但不会变空。
→ 据此做的是「切回标签即刷新」（治陈旧），而不是重构数据流。

### 浏览器 UX 审计（8 条用户旅程，40 张截图）

- **P1 草稿串目标**：为 A 目标写的文字，切到 B 目标后还在输入框里，一点提交就投进了 B。
  → 切目标时**清空草稿**。
- **P1 新装面板没有输入框**：工具栏已经写着投递目标，却找不到 composer（选择器当前值
  就是目标 → 不触发 change → 面板不开）。→ 队列面板**默认打开**。
- **P1 到点的目标在行里显示「未设置」**（其实归档区写着已到点）→ 行里显示「已到点（见归档区）」。
- **P1 「空闲」这个标签没有解释**（它说的是"没有 agent 在等"，却挨着待领数）→ 加 tooltip。
- **P2 文案里漏出 markdown 星号**（`按**目录名**认队列`）→ 去掉。
- **P2 「超时 1:26」被读成 1 小时 26 分**（紧凑时钟用在超时上）→ 改人话时长。
- **P2 归档区承诺「仍可查提示词与日志」但没有日志入口** → 补「日志」按钮（走 timegoal log）。
- **P2 看板按最近更新排序 → 任意一次领取都让整张表重排，行在光标底下跳走** → 按目录名排序。
- **P2 「投递到」下拉与它控制的输入框隔着一整张表** → 下拉移到输入框旁边。
- **P2 单条删除没有确认、删除队列的提示不含队列名** → 软删除 + 提示说清可恢复。

## 参考仓库

`kanboard`（泳道/软删）、`focalboard`（影子历史表/恢复）、`asynq`（任务状态分层）、
`opencode`（SSE 加固、事件订阅溢出语义）—— 已 clone 到 `.claude/repo/`，URL 登记在
`.claude/www/git.remote`。

## 对照基准（视觉轮实测，数字来自各自的真实页面）

| 参照 | 行高 | 文字层级 | 圆角 | 阴影 |
| --- | --- | --- | --- | --- |
| **GitLab Work Items** | 64px | 14/600 + 12/400（**一行只有 2 级字号**） | 标签 12px/radius 12px | 无边框无圆角 |
| **Trello** | 20·32·40·48·60px | 14/20 + 12/16 | 4 / 6 / 9999 | `0 1px 1px + 0 0 1px`（1px 环） |
| **GitHub Issues** | ≈36px | 14/21 + 12/18 | 6 / 3 / 9999 | — |
| **Plane** | — | 9→36px 共 10 档（token 膨胀，抄命名别抄数量） | 3/10/20/50 | — |
| **WeKan** | 卡片 36/40px | 标题 14 | 6 | `0 8px 16px rgba(0,0,0,.15)`（**卡片汤，反面教材**） |
| **Kanboard** | — | — | 2 / 5 / 6 | `#eee` 全网格（2012 年后台味，反面教材） |

**我们缺的 5 件事**（每条都带参照值）：一行的字号只有 2 级（我们原来 8 种字号 4 种字重）、
行高 ≤56px（原来 93px）、状态是胶囊不是裸字、每行右端有归属锚点（我们队列里明明有
`claimedByName`）、逾期要有颜色。
