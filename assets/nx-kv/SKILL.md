---
name: nx-kv
description: 通过 nx-kv CLI 操作 KV 清单（todo）—— 领取某个主题的任务、回报完成结果、维护主题上下文提示词、在多个工作空间之间切换。当需要「取某主题的待办」「把任务标记完成」「看完成历史」「给主题配上下文」「切换工作空间」时使用。触发词：领取任务、我的待办、某主题的任务、todo、清单、发布任务、完成回填、工作空间/group 切换。
---

# nx-kv — KV 清单操作手册

nx-kv 是 `kvcli` 的 Node 实现，对接同一后端（GoFrame KV），**四把 key** 上的任务管理：

| key | 内容 | 说明 |
| --- | --- | --- |
| `todo:open` | Task[] | 待办 |
| `todo:done` | Task[] | 已完成（含完成结果 note） |
| `todo:freeze` | Task[] | 冻结（次级需求停放区，id 保留） |
| `todo:topics` | String[] | 快捷主题列表 |
| `todo:prompt:<topic>` | 纯文本 | 该主题的上下文提示词 |
| `todo:done:cold:<日期>` | Task[] | 冷归档（app 只写不查） |

**没有手写的命令清单**：CLI 命令表、HTTP 路由、`help` 文本都由同一份 action 声明派生。
`nx-kv routes` 可查命令与端点的对照，`nx-kv routes --http "POST /api/todo"` 能反查。

## 前置

```bash
nx-kv auth login <email>     # 交互式隐藏输入密码；也会保存默认后端地址
nx-kv auth status            # 看登录态（离线可读本机配置）
nx-kv group list             # 我的工作空间（* 为当前）
```

**所有 todo 操作都需要登录**，否则报「未登录」并 exit 1。

## 取任务：按主题一把拿全

```bash
nx-kv todo list --status open --topic go          # 该主题的全部待办
nx-kv todo list --status open --topic go --json   # 机器可读
```

> **首选 `--status open --topic <你的主题>`**：只读一把 key，输出纯待办，不带已完成的历史噪音
> （done 里有重复 id 和长 note，会白占上下文）。

拿任务时**顺带读走主题的上下文提示词** —— 这是「拿任务即拿上下文」的关键：

```bash
nx-kv prompt get go --json    # → {"topic":"go","prompt":"...","hasPrompt":true}
```

## 完成并回填

```bash
ID=$(nx-kv todo list --status open --topic go --json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).open[0].id")
nx-kv todo done "$ID" --result "已修复根因: ..."    # note 会写进 done 记录
```

## ⚠️ 最容易踩的坑：id 不唯一

**`id` 不是唯一键。** id 分配只扫「待办 + 冻结」，所以任务完成、待办清空之后，
新任务会**重新用上已被完成任务占过的 id** —— `todo:done` 里因此会积累同 id 的多条。

实测这份数据：done 68 条里有 **7 条 id=29**。

后果与对策：

```bash
# 直接按 id 操作会被拒绝（这是刻意的，不替调用方猜）
nx-kv todo remove 29
# 错误: id=29 命中 7 条，无法确定是哪一条。用 --pick <n> 选择：
#   [0] done   qus   2026-08-15T15:09:00.097123  k8s的slb是什么
#   [1] done   qus   2026-08-22T10:40:12.469526  专业远控软件...
#   ...

# 两条消歧手段：
nx-kv todo get 29 --topic fr      # 按主题收窄（同 id 分属不同主题时够用）
nx-kv todo get 29 --pick 2        # 按编号选（同 id 且同主题时唯一可靠的方式）
```

同一规则适用于 `get` / `update` / `remove` / `done` / `freeze` / `unfreeze`。
`update` 用 `--match-topic` 消歧（`--topic` 在那里表示「改成这个主题」）。

**只在 `todo:open` 和 `todo:freeze` 里，id 才是唯一的** —— 那里的操作一般不需要消歧。

## 工作空间

后端按 `groupId` 隔离数据（实测 shared 组比默认组少 4 条）。

```bash
nx-kv group list                 # 列出（* 为当前）
nx-kv group use shared           # 按名字切
nx-kv group use 24               # 按 id 切
nx-kv group use default          # 回默认组（不传 groupId）
nx-kv todo list --group 190      # 单次覆盖，不改当前设置
```

切换只改本机配置，**不动服务端任何数据**。

## 其余命令

```bash
nx-kv todo get <id> [--topic T]
nx-kv todo update <id> --text ... [--match-topic T]   # PATCH 语义：只改传入的字段
nx-kv todo freeze <id> / unfreeze <id>
nx-kv topic list / add <name> / remove <name>
nx-kv prompt set <topic> "<上下文>" / get <topic> / remove <topic>
nx-kv todo archive [--before 2026-08-01]              # 完成记录归档到冷 key
nx-kv todo list --status all                          # 三桶全列
```

## 输出契约（agent 依赖）

| 契约 | 内容 |
| --- | --- |
| `--json` | 单个 JSON 值到 stdout；成功输出数据本身，不套外壳 |
| 失败 | `{"ok":false,"error":"…","code":"…"}` + exit 1 |
| 退出码 | `0` 成功；`1` 失败（含「同 id 多条」这类需要消歧的情况） |
| 错误锚点 | 文本含「未登录」「不存在」「用法:」——可用于分支判断 |

**冲突不是失败**：`todo.freeze` 遇到已冻结、`done` 遇到已完成，都返回 `code=CONFLICT` 并 exit 1，
但语义是「状态已经是你要的了」，直接跳过即可。

## 与 kvcli 的关系

两者对接同一个后端、同一份数据，可以混用。差异：

- nx-kv 额外管 `todo:freeze` 与 `todo:topics`（不只 open/done）
- nx-kv 有 Web 面板：`nx-kv serve`
- nx-kv 对「同 id 多条」有显式防护；kvcli 的 `done` 只在 open 里按 id 匹配

详细命令清单与避坑见 [[todo-commands]]；把任务队列当工作流的 SOP 见 [[agent-workflow]]。
