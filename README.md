# nx-kv

KV 清单（todo）管理中枢。一个 `npx` 命令起一个 Web 面板，同时提供同构 CLI——
**面板上的每个按钮，底层都是同一条 CLI 命令**，输出 `--json` 即可被任何 agent 直接消费。

对接 GoFrame KV 后端（默认 `http://47.110.80.47:8988`），
数据落在**四把 key** 上：`todo:open` / `todo:done` / `todo:freeze` / `todo:topics`。

任务正文还能直接**嵌图片与文档**（标准 markdown：`![说明](fileId)` / `[文件名](fileId)`）——
附件存在后端图床的同一用户空间里，既能同步到本地给 agent 直接读（`nx-kv file sync`），
也能在读任务时自动下载并把本地绝对路径一并交出去。

## 快速开始

```bash
pnpm install

# 开发模式（需要两个终端）
pnpm run dev:serve    # 终端 1：后端 :7877
pnpm run dev          # 终端 2：Vite :5181，/api 代理到 7877

# 生产模式
pnpm start            # 构建 + 起面板

# 校验：lint + 构建 + 94 项端到端冒烟 + 33 项单元/一致性测试
pnpm test
```

冒烟测试**对着假后端跑**（`tests/fake-backend.mjs`），不会碰生产服务器上的真实数据。

`nx-kv serve` 默认会打开浏览器；**端口被占时不会报错退出**：

- 占用者**就是本项目的面板** → 直接复用它（不重复起进程），并打开它；
- 占用者是别的服务 → 顺延到**下一个空闲端口**起自己的面板，并打开它。

`--no-open` 只关这一次；`NX_SERVE_NO_OPEN=1`（`true` / `yes` / `on` 同义）则是**所有 nx-xx 项目共用**的全局开关，设为真值后 `serve` 完全不开浏览器。

## 登录

```bash
nx-kv auth login <email>          # 交互式隐藏输入密码
nx-kv auth status                 # 看登录态（离线可读）
```

token 存 `~/.nx-kv/config.json`，**密码不落盘**。配置文件路径可用 `NX_KV_CONFIG`
环境变量或 `--config` 覆盖。

## 常用命令

```bash
# 取某个主题的全部待办（agent 首选）
nx-kv todo list --status open --topic go --json
nx-kv prompt get go --json                    # 顺带拿该主题的上下文提示词

# 增删改查 —— 单条操作一律按**内容**定位（--ref），不用 id
nx-kv todo add --topic go "把 watchkv 的告警接进来"
nx-kv todo get --ref "把 watchkv 的告警接进来"
nx-kv todo update --ref "旧内容" --text "改过的内容"
nx-kv todo remove --ref "要删的那条"

# 状态流转
nx-kv todo done --ref "那条任务" --result "已接入，commit abc123"
nx-kv todo freeze --ref "那条任务"        # 次级需求停放，id 保留
nx-kv todo unfreeze --ref "那条任务"      # 解冻回待办（id 撞车时自动换新 id）
nx-kv todo archive          # 完成记录归档到冷 key（默认 30 天前）

# 主题 / 工作空间
nx-kv topic list
nx-kv group list
nx-kv group use shared      # 切换工作空间（只改本机配置）
nx-kv group add 新空间 --description "..."   # 建
nx-kv group update 507 --name 改个名          # 改
nx-kv group remove 507                        # 解散（组内须无 KV）
nx-kv group members 24                        # 成员
```

完整命令表由 action 声明自动生成：`nx-kv help`。
命令与 HTTP 端点互相可查：`nx-kv routes`，反查用 `nx-kv routes --http "POST /api/todo"`。

## 附件（图片 / 文档）

任务正文直接用**标准 markdown** 引用附件，附件本体存在后端图床的同一用户空间里：

```
修一下首页 logo  ![设计稿](3f2a1b…9c)      # 图片：面板内联预览
补充材料见 [需求说明.docx](b71e…04.docx)    # 其他文件：点开即下载/预览
```

括号里是后端返回的 `fileId`（32 位 hex，原文件名带后缀时会接 `.<ext>`）。
URL 与相对路径不算附件，按普通 markdown 原样保留（不会误判）。

```bash
nx-kv file upload --path "D:\设计\首页.png"   # 上传到当前用户空间
nx-kv todo attach --ref "修一下首页 logo" --path "D:\设计\首页.png"  # 上传并嵌进正文
nx-kv todo attachments --ref "修一下首页 logo"   # 这条任务引用了哪些附件

nx-kv file sync            # 把附件同步到 ~/.nx-kv/attachments/<工作空间>/
nx-kv file sync --ids a,b  # 只同步指定附件
nx-kv file sync --prune    # 顺带清掉本地已不在后端的（仅全量同步时生效）
```

面板里编辑任务时，**Ctrl+V 直接粘截图**、把文件拖进来、或点「选择文件」——
都会自动上传并插到光标处，右侧实时预览；列表里图片显示为缩略图、其他文件是可点附件。
「快速新增」那一栏也支持粘贴图片。

**给 agent 的关键开关**：开启「读任务时自动下载」后，`todo list` / `todo get`
的每个任务会多出 `attachments[]`，里面是**本地绝对路径**，另有 `attachmentsSync`
汇报下载/跳过/失败。读本地文件因此不再受网络与跨域影响：

```bash
nx-kv setting set --autoSyncAttachments        # 开
nx-kv setting set --autoSyncAttachments=false  # 关（默认）
```

面板里对应「清单」页工具栏的「附件自动下载」勾选。本地文件名优先取正文里的说明文字
（`![设计稿.png](id)` → `设计稿.png`），否则退回 fileId 并补上扩展名；
同目录 `manifest.json` 记「fileId → 文件名 + 大小」，所以二次同步会跳过未变更的。

单独的命令参考见 `nx-kv help file` 与 skill 的 `todo-commands`。

## 本地任务（localtask，不需登录）

本机任务队列，按**工作目录**划分（目录名即主题）：提交（`add`）、领取（`wait`）、
队列管理（`list / get / update / remove / reorder`）与主题管理（`topic remove /
remove-many`）。阻塞等待弹窗只是 `wait` 当前的一个子功能。三个 skill 角色共用
同一条队列、一套存储：

```bash
# 等待侧：每完成一步、提交结果后【必须】调 wait 领新任务（循环只有 timeout 才终止）
nx-kv localtask wait --summary "<当前现状总结>" --json
# 队列非空 → 立即取走（queued:true）；空 → 开窗阻塞，默认 180 秒未回填 → {status:"timeout"}（exit 0）

# 提交侧：把提炼好的任务投进目标目录的队列，委托在那边工作的 agent
nx-kv localtask add "<任务文本>" --cwd "<目标工作目录>" --json
```

现状总结只作展示（弹窗/面板顶部），不参与队列分桶；任务按各目录队列的先后
领取。其余命令：`localtask list / get / update / remove / reorder`，以及主题级
`localtask topic remove`（删整个主题）与 `localtask topic remove-many`
（批量删除，`--keys/--cwds/--all`；等待中需 `--force`），面板上对应「本地任务」页。
纯本机协调、存本地文件（`~/.nx-kv/localtasks.json`），**不需登录后端**。

**全局共享池（工作窃取）**：除按目录划分的本地队列外，还有一个跨目录共享的
「全局任务池」。本地队列取不到任务时，任何目录的 `wait` 都自动去全局领
（显式传 `--cwd` 也不例外）——谁闲谁领。投递用 `--global`：

```bash
nx-kv localtask add "<任务文本>" --global --json   # 投进全局池，不限目录
```

面板上「本地任务」页的目录看板**恒有一行「全局任务」**（哪怕池子是空的），
用工具栏的**「投递到」**下拉直接切到全局池或某个目录，任务就投到那儿——
只有一个投递目标，不再有"勾了全局但选中的是目录"这种会静默投错池子的中间态。
全局池的队列也能直接打开，已领取的历史照常列在表里。

配套 skill（三件套各管一角；远程清单仍归 nx-kv 主 skill）：

```bash
nx-kv skill install kv-waittask   # 等待侧：agent 最后一步阻塞等用户喂任务
nx-kv skill install kv-submit     # 提交侧：总结上下文、提炼需求，委托别的 agent
nx-kv skill install kv-localget   # 领取侧：主动领取排给本目录的任务
```

## 时间目标（timegoal，不需登录）

把「AI 持续运行 N 小时」这类长任务**固化到工具里**，而不是散落在外部脚本：

每个**工作目录**绑定一个 timegoal = 「持续时长 + 一段完整全局提示词」。

```bash
# 开头设一次：3 小时 + 完整提示词（提示词会被原文固化到 store）
nx-kv timegoal set --cwd "$PWD" --duration 10800 --prompt "<完整全局提示词>" --json

# 时长按人话说：5h / 90m / 2d / 5小时 都认，纯秒数（10800）照样能用
nx-kv timegoal set --cwd "$PWD" --duration 5h --prompt "<完整全局提示词>" --json

# 每轮调一次：算出还剩多少时间，并把提示词【原文】回显给你
nx-kv timegoal check --cwd "$PWD" --summary "<当前现状>" --progress "<完成度/下一步>" --json
#   → { reached:false, remainingSec:10780, prompt:"<完整提示词原文>", deadline, ... }

# 提示词要改（agent 自我迭代 / 用户在面板上改）——只换提示词，保住计时起点
nx-kv timegoal update --cwd "$PWD" --prompt "<新版>" [--duration 5h] --json

# 其余：show（仅查）/ clear（清空）/ list（总览所有目录）/ log（回看每轮检查记录）
```

**为什么需要它**：长对话里 agent 一定会把自己手里的提示词改写、漂移、漏条件。
`check` 每次把 store 里的**原文**回显出来，agent 就没有"凭记忆发挥"的空间。
到点时 `reached:true`，agent 据此停手、收尾。

**时长上限 365 天**：`--duration` 最低 1 分钟、最高 365 天。24 小时的老上限挡掉了
"跑一晚上""连续优化几天"这类真实需求，现在不必再切天。

**到点自动回收**：目标过了截止时刻就**自动归档**——从看板/列表里消失，不再堆着；
但 `show` / `check` 仍查得到（agent 最后一轮照样拿到 `reached:true` + 提示词原文，
好写最终总结），归档满 7 天后自动丢弃**检查日志**、**提示词原文始终保留**。
`check` 还会报出 `overtimeSec`（已经超时多久），面板上显示「已到点 · 超时 2:13:45」，
不再是一句静止的"已到点"。每轮的检查日志只保留最近 200 条（总轮次与是否截断都
看得到，不静默丢历史），长跑任务不会把 store 撑爆。

**完全独立的模块**：独立 store（`~/.nx-kv/timegoals.json`）、独立命令族、
独立循环——不调用 `localtask wait`、不被它调用，两者可以同时跑。
面板上嵌在「本地任务」页（顶部「时间目标」汇总卡 + 每个主题卡里一行），
纯粹是为了查看与编辑方便。

```bash
nx-kv skill install kv-timegoal   # 持续 N 小时任务的时序与提示词模板
```

## ⚠️ 定位一律按内容，不按 id

待办的 id **非常容易重复**，两条独立的原因：

1. 分配只扫「待办 + 冻结」，任务完成、待办清空后 **id 会被复用**——
   `todo:done` 里因此会积累同 id 的多条（实测 68 条里有 7 条 id=29）。
2. 同一个主题下，内容重复本来就是常态——「修复登录页」这类任务会被反复投递。

所以 `id` 在本项目里**只是给人和外部系统看的元数据**：继续分配、继续出现在输出里，
但**不再是任何命令的入参**。定位一律用任务内容：

```bash
nx-kv todo done --ref "把 watchkv 的告警接进来" --result "已接入"
```

内容命中多条时工具**拒绝猜**，而是列出候选项让你选：

```
$ nx-kv todo get --ref "旧记录"
错误: task「旧记录」命中 3 条，无法确定是哪一条。用 --pick <n> 选择：
  [0] done   qus   2026-08-15T15:09:00.097123
  [1] done   qus   2026-08-22T10:40:12.469526
  [2] done   fr    2026-08-30T10:36:25.731238
```

```bash
nx-kv todo get --ref "旧记录" --pick 1     # 按编号选
nx-kv todo get --ref "旧记录" --topic fr   # 或按主题收窄
```

同一规则适用于 `get` / `update` / `remove` / `done` / `freeze` / `unfreeze`。
`update` 用 `--match-topic` 消歧（`--topic` 在那里表示「改成这个主题」）。
内容含空格时给 `--ref` 加引号。

## 架构：action 三端同源

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Web 面板     │   │   agent CLI  │   │  HTTP API    │
└───────┬──────┘   └───────┬──────┘   └───────┬──────┘
        └──────────────────┼──────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  action 声明（每个功能域的 index.js）      │
        │  { cli: [...], http: [...], run, render } │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  service 层（唯一业务真相源）              │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  core：KV 客户端 / 配置 / 错误 / 存储      │
        └──────────────────────────────────────────┘
```

**一条 action 同时声明 CLI 命令路径与 HTTP 路由**，二者写在同一处，
所以「Web 上能做的，CLI 都能做」是结构保证而非口头约定。

```
src/core/          零业务语义：kvapi / fileapi（后端客户端） / attachstore（附件本地镜像） / config / errors / fstree
src/modules/       功能域：system / setting / auth / group / localtask / timegoal / todo / file / bundled
src/runtime/       装配层：registry / spec / cli / api / server
src/web/frontend/  React 壳
assets/nx-kv/            内置 skill：KV 清单操作手册（远程）
assets/kv-waittask/         内置 skill：对话内本地任务接力（等待侧）
assets/kv-submit/        内置 skill：需求提炼与委托提交（提交侧）
assets/kv-localget/         内置 skill：领取本目录本地任务（领取侧）
assets/kv-timegoal/         内置 skill：持续 N 小时任务的时间目标与提示词回显
```

分层由 `eslint.config.js` 的 `no-restricted-imports` 强制；
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐。

## 给 agent 用

```bash
nx-kv skill install      # 装到 ~/.claude/skills/nx-kv（KV 清单操作手册，远程）
nx-kv skill install kv-waittask      # 本地任务接力：最后一步阻塞等用户喂任务
nx-kv skill install kv-submit     # 提交侧：总结上下文、提炼需求，委托别的 agent
nx-kv skill install kv-localget      # 领取侧：主动领取排给本目录的任务
nx-kv skill install kv-timegoal      # 持续 N 小时任务：每轮回显提示词原文、到点自动停手
nx-kv skill list         # 列出可装 skill、默认安装项与可装 group
nx-kv skill groups       # 列出 group → 包含哪些 skill
nx-kv skill install --group=<key>    # 一键装整组（与 <name> 二选一）
nx-kv skill get [name] [ref]         # 输出 skill 全文，外部 agent 一键拿上下文
```

装好后 agent 就能按 skill 里的 SOP 领任务、读主题上下文、完成后回填结果；
或在一个对话里靠 `localtask wait` 阻塞弹窗、连续接收用户任务，
把需求提炼成任务 `add` 到别的目录委托其它 agent，或主动领取排给本目录的任务。

## License

MIT
