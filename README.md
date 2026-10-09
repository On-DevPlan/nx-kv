# nx-kv

KV 清单（todo）管理中枢。一个 `npx` 命令起一个 Web 面板，同时提供同构 CLI——
**面板上的每个按钮，底层都是同一条 CLI 命令**，输出 `--json` 即可被任何 agent 直接消费。

对接 GoFrame KV 后端（默认 `http://47.110.80.47:8988`），
数据落在**四把 key** 上：`todo:open` / `todo:done` / `todo:freeze` / `todo:topics`。

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

## 实时任务输入（对话内连续提交）

在一个对话里，agent 完成当前任务、提交结果、需要下一条输入时，可调用**阻塞式**
命令等用户在浏览器回填，替代在原始输入框打字：

```bash
# 本轮【最后一步】：阻塞并自动打开浏览器弹窗（工具调用超时需设为 120000ms）
nx-kv sessiontask wait --summary "<当前现状总结>" --json
# 成功 → {status:"ok", task:{text,...}}；120 秒未回填 → {status:"timeout"}（exit 0）
```

**现状总结即等待点 key**：同现状用同一句总结复用同一等待点，新现状换新句分散为
新等待点。弹窗/面板顶部直接显示现状，用户不读对话也能快速了解、点选等待点
**分别回填（分散答复）**，也可提前排队；等待点非空时 wait 立即取走、不开窗。
纯本机协调、存本地文件，**不需登录后端**。其余命令：
`sessiontask list / add / get / update / remove`，以及主题级
`sessiontask topic remove`（删整个主题）与 `sessiontask topic remove-many`
（批量删除，`--keys/--cwds/--all`；等待中需 `--force`），面板上对应「实时任务」页。

配套 skill：

```bash
nx-kv skill install kv-sessiontask     # 教 agent 在最后一步阻塞等用户喂任务
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
src/core/          零业务语义：kvapi(后端客户端) / config(本机配置) / errors / fstree
src/modules/       功能域：system / auth / group / sessiontask / todo / bundled
src/runtime/       装配层：registry / spec / cli / api / server
src/web/frontend/  React 壳
assets/nx-kv/            内置 skill：KV 清单操作手册
assets/kv-sessiontask/   内置 skill：对话内实时任务接力
```

分层由 `eslint.config.js` 的 `no-restricted-imports` 强制；
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐。

## 给 agent 用

```bash
nx-kv skill install      # 装到 ~/.claude/skills/nx-kv（KV 清单操作手册）
nx-kv skill install kv-sessiontask   # 实时任务接力：最后一步阻塞等用户喂任务
nx-kv skill list         # 列出可装 skill、默认安装项与可装 group
nx-kv skill groups       # 列出 group → 包含哪些 skill
nx-kv skill install --group=<key>    # 一键装整组（与 <name> 二选一）
nx-kv skill get [name] [ref]         # 输出 skill 全文，外部 agent 一键拿上下文
```

装好后 agent 就能按 skill 里的 SOP 领任务、读主题上下文、完成后回填结果；
或在一个对话里靠 `sessiontask wait` 阻塞弹窗、连续接收用户任务。

## License

MIT
