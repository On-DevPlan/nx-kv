# nx-kv 命令参考

> 归属主文档 [[nx-kv]]。**当且仅当**要执行具体命令、或校验退出码/输出结构时加载本文件。
> 覆盖：前置条件、命令清单、退出码、数据结构、典型用法、与 kvcli 的对应关系、避坑。

## 前置条件

1. **命令就绪**：`nx-kv` 在可执行路径上（`npx nx-kv` 亦可）
2. **登录态**：`nx-kv auth login <email>`，token 存 `~/.nx-kv/config.json`
3. **后端可达**：默认 `http://47.110.80.47:8988`；用 `--baseUrl` 临时覆盖，或写进配置

所有清单操作都需要登录，否则报「未登录」并 exit 1。

## 全局

| 命令 | 说明 |
| --- | --- |
| `nx-kv serve [--port 7877] [--no-open]` | 起 Web 面板（`--no-open` 给自动化） |
| `nx-kv help [模块]` | 命令表（由动作声明生成）；`help todo` / `help group` 均可 |
| `nx-kv routes [--module M] [--http "METHOD /api/x"]` | 命令 ↔ 路由对照与反查 |
| `nx-kv bootstrap --json` | 一次拿齐：版本 / 登录态 / 工作空间 / 命令表 |
| `nx-kv health` | 本机配置 + 后端可达性 |
| `--config <path>` | 本次运行覆盖配置文件（默认 `~/.nx-kv/config.json`） |

## 认证

```bash
nx-kv auth login <email> [--password P] [--baseUrl URL]
nx-kv auth logout
nx-kv auth status          # 离线可读，不请求后端
nx-kv auth me              # 向后端确认 token 仍有效
```

`--password` 省略时进入**隐藏式交互输入**。token 存本机配置，**密码不落盘**。

## 清单

```bash
nx-kv todo list [--topic T] [--status open|done|freeze|all] [--group N] [--json]
nx-kv todo get --ref "<内容>" [--topic T] [--pick N] [--group N]
nx-kv todo add <text> --topic T [--group N]
nx-kv todo update --ref "<内容>" [--topic T] [--text T] [--note N] [--match-topic T] [--pick N]
nx-kv todo remove --ref "<内容>" [--topic T] [--pick N]
nx-kv todo done --ref "<内容>" [--result "完成结果"] [--topic T] [--pick N]
nx-kv todo freeze --ref "<内容>" [--topic T] [--pick N]
nx-kv todo unfreeze --ref "<内容>" [--topic T] [--pick N]
nx-kv todo archive [--before 2026-08-01] [--group N]
```

**单条操作一律用 `--ref` 传任务内容整串，不要用 id**（见下节）。
内容含空格时加引号：`--ref "修复登录页 500"`。

**CRUD 五操作齐备**（`list` / `get` / `add` / `update` / `remove`），
且每条都能从 CLI 与 HTTP 两端调用——`tests/unit/registry.test.mjs` 有断言。
单条操作的 HTTP 路径是 `/api/todo/item`，定位内容走 `ref` 参数（不放路径里）。

**两种取法的区别**：

| 想要 | 命令 | 拿到 |
| --- | --- | --- |
| **某主题的全部任务** | `nx-kv todo list --topic T` | 三个桶：待办 + 已完成 + 冻结 |
| 只要待办（收单首选） | `nx-kv todo list --status open --topic T` | 只读一把 key，无历史噪音 |
| 只要完成历史 | `nx-kv todo list --status done --topic T` | 含完成结果 note |
| 只要冻结区 | `nx-kv todo list --status freeze --topic T` | 次级需求停放区 |

不带 `--topic` 时就是全量（所有主题）。

## 主题与提示词

```bash
nx-kv topic list                      # 含各状态任务数
nx-kv topic add <name>
nx-kv topic remove <name>             # 移出候选；仍有任务在用时会提示条数

nx-kv prompt set <topic> "<上下文>"
nx-kv prompt get <topic> [--json]     # --json → {topic,prompt,hasPrompt}
nx-kv prompt remove <topic>
```

`todo:prompt:<topic>` 是**纯文本**（不是 JSON），存该主题的共享上下文。

## 工作空间

```bash
nx-kv group list
nx-kv group get <id|name>
nx-kv group add <name> [--description D]
nx-kv group update <id> [--name N] [--description D]
nx-kv group remove <id>               # 解散；不能删当前使用中的，且后端要求组内无 KV
nx-kv group members <id>
nx-kv group current
nx-kv group use <id|name|default>     # 别名：group switch
```

## ⚠️ 定位按内容（--ref），不按 id

```jsonc
// todo:open / todo:done / todo:freeze 里的一条
{
  "id": 23,                                     // ★ 仅供展示/互操作，不要用来定位
  "topic": "go",
  "text": "watchkv",                            // ★ 定位就用这个（整串）
  "createdAt": "2026-08-14T19:04:56.028788",   // Dart 风格：本地时间、无时区
  "doneAt": "",                                 // 完成时写 RFC3339 带偏移
  "note": "",                                   // done --result 写这里
  "frozenAt": ""                                // 冻结时写 Dart 风格
}
```

id 会重复（分配只扫 open + freeze，完成过的 id 会被复用），
同一主题下内容重复也是常态。所以：

| 想要 | 写法 |
| --- | --- |
| 精确一条 | `--ref "<完整内容>"` |
| 内容有多条 → 按编号选 | `--ref "<内容>" --pick <n>`（n 从报错里的候选列表取） |
| 内容有多条 → 按主题收窄 | `--ref "<内容>" --topic <主题>` |
| `update` 时消歧 | 用 `--match-topic`（`--topic` 表示「改成这个主题」） |

内容命中多条时**报错并列出候选**（exit 1 / code `CONFLICT`），**绝不替你猜**。这是保护，不是 bug。

`--ref` 传空串会报 `INVALID_INPUT`——挡住「忘了传 --ref 却恰好命中一条 text 为空的坏数据」。

| key | 内容 |
| --- | --- |
| `todo:open` | Task[] 待办 |
| `todo:done` | Task[] 已完成（含完成结果 note） |
| `todo:freeze` | Task[] 冻结（次级需求停放区，id 保留） |
| `todo:topics` | String[] 快捷主题列表 |
| `todo:prompt:<topic>` | 纯文本：该主题的上下文提示词 |
| `todo:done:cold:<日期>` | Task[] 冷归档（app 只写不查） |

两种时间格式在同一份数据里并存是**既成事实**，nx-kv 按字段各自的约定写，不做统一。

## 退出码与错误码

| 情形 | exit | code |
| --- | --- | --- |
| 成功 | 0 | — |
| 参数缺失/非法 | 1 | `INVALID_INPUT` |
| 未登录 / token 失效 | 1 | `INVALID_INPUT`（文本含「未登录」） |
| 目标不存在 | 1 | `NOT_FOUND` |
| **同内容多条需消歧** | 1 | `CONFLICT` |
| 状态已是目标（已完成/已冻结） | 1 | `CONFLICT` |
| 后端不可达 / 返回业务错误 | 1 | `EXTERNAL` |

**脚本里只看退出码判定成败**，不要 parse 人类文案（需要分支时用 `code`）。

## 典型用法

**收单一条龙**（提交 → 拉取 → 回填）：

```bash
# 提交方
nx-kv todo add --topic bug "修复登录页 500"

# 消费方取该主题全部待办
nx-kv todo list --status open --topic bug --json
# → [{...},{...}] 纯待办数组

# 用返回里的 .text 原样回填（不要用 .id）
nx-kv todo done --ref "修复登录页 500" --result "已修复根因: token 过期未刷新；补了 3 个单测"
```

**主题提示词（让 agent 拿任务即拿上下文）**：

```bash
nx-kv prompt set go "Go 1.25; 多模块 go.work; 优先标准库; 错误用 fmt.Errorf+%w"
nx-kv prompt get go --json     # → {"topic":"go","prompt":"...","hasPrompt":true}
```

**多消费者各拉各的**：

```bash
nx-kv todo add --topic docs "更新 API 文档"
nx-kv todo add --topic bug  "登录页 500"

nx-kv todo list --status open --topic docs   # docs 消费者
nx-kv todo list --status open --topic bug    # bug 消费者
```

**空 open 的处理**：列表为空时输出「待办: （空）」（JSON 模式给空数组），exit 0。
脚本据此判定无任务可做。

## 与 kvcli 的对应关系

两者对接同一后端、同一份数据。环境里只有 `kvcli` 时按下表换算：

| 本 skill 写法 | 等价的 kvcli 写法 |
| --- | --- |
| `nx-kv todo list --status open --topic t` | `kvcli todo --open --topic t` |
| `nx-kv todo list --topic t` | `kvcli todo list --topic t` |
| `nx-kv todo get --ref "<内容>"` | `kvcli todo first --topic t`（部分场景） |
| `nx-kv todo add --topic t "<文本>"` | `kvcli todo add --topic t "<文本>"` |
| `nx-kv todo done --ref "<内容>" --result "..."` | `kvcli todo done <id> --result "..."`（只能按 id） |
| `nx-kv prompt get/set/remove --topic t` | `kvcli todo prompt get/set/del --topic t` |
| （无对应） | —— |

> ⚠️ 换算到 kvcli 的 `done <id>` 时要知道风险：kvcli 按 **id** 在 open 里匹配，
> 而 id 会被复用。当日志/清单里出现同 id 多条时，它可能完成掉另一条。
> 能用 nx-kv 就别换算。

**kvcli 没有的能力**：`todo:freeze`、`todo:topics`、`todo archive`、Web 面板、
以及**按内容定位与「同内容多条」的消歧防护**。要用这些就得用 nx-kv。

## 避坑

| 坑 | 后果 | 注意 |
| --- | --- | --- |
| **拿 id 去定位**（`--ref 29` / `todo done 29`） | 报「不存在」，或命中一条完全不相干的记录 | id 不是定位键。`--ref` 要传**内容整串** |
| 「同内容」有多条 | 报「命中 N 条」——这是保护，不是 bug | 用 `--topic` 收窄，或 `--pick <n>` 按编号选 |
| `--ref` 忘了加引号 | 内容被空格切碎，报「多余的参数」 | `--ref "修复登录页 500"` |
| 漏传 `--ref` / 传空串 | exit 1，`INVALID_INPUT` | 空串会被挡下，不会误命中 text 为空的坏条目 |
| `add` 漏 `--topic` | exit 1，`--topic 必填` | 必带 |
| 未登录就调 todo | exit 1「未登录」 | 先 `auth login` |
| 以为切换 group 会改服务端 | 只改本机配置 | 数据一直在服务端，切换只是换个 groupId |
| 领取待办时用了全量 `list` | done 的历史 + 长 note 白占上下文 | 一律 `--status open --topic <t>` |
