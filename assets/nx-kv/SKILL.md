---
name: nx-kv
description: KV 清单（todo）的收单与操作 —— 既用来**领取任务、确认意图、完成后回填**，也用来直接读写清单、维护主题提示词、在多个工作空间之间切换。触发词：领取任务、我的待办、看一下我的任务、某主题的任务（如「go 主题的任务」）、发布的任务、发布任务、收单、先确认再执行、把任务聚个类、任务队列、todo、清单、完成回填、给主题配上下文、切换工作空间/group。凡「提交方 → KV 清单 → agent 消费」这条任务流里 agent 一侧的收单动作，或任何要直接操作清单的命令，都走本 skill。
---

# nx-kv — 收单流程 + 命令手册

KV 清单（todo）的操作入口。四把 key 上的任务管理，对接 GoFrame KV 后端。

> 历史：本 skill 合并了原先独立的 `taskget`。以前它走 `kvcli`，现在统一走 `nx-kv`——
> 后者是同一后端的 Node 实现，多了 Web 面板、覆盖全部四把 key（含 freeze / topics）、
> 且随包自带本 skill（`nx-kv skill install` 一条命令装好）。

## 先判断你要做哪件事

| 你要做的事 | 读哪份 |
| --- | --- |
| **领任务 / 收单**：按主题拉待办 → 读上下文 → 与用户对齐意图 → 完成后回填 | [[agent-workflow]] |
| **查命令**：要敲哪条、退出码、数据结构、避坑 | [[todo-commands]] |

两份都是按需加载，不要一开始就全读进来。

## 前置

```bash
nx-kv auth login <email>     # 交互式隐藏输入密码；同时记住后端地址
nx-kv auth status            # 看登录态（离线可读本机配置）
nx-kv group current          # 当前工作空间
```

**所有清单操作都需要登录**，否则报「未登录」并 exit 1。

数据按 `groupId` 隔离。**先确认工作空间对不对**——在错的空间里会「什么都查不到」，
而那不是「没有任务」，是「看错地方了」。

## 最常用的四条

```bash
# 1. 取某主题的全部任务（三个桶一次拿全：待办 + 已完成 + 冻结）
nx-kv todo list --topic <topic> --json
# → { topic, status:'all', open:[...], done:[...], freeze:[...], topics:[...] }

# 2. 只取待办（收单首选；只读一把 key，不带已完成历史，省上下文）
nx-kv todo list --status open --topic <topic> --json
# → open:[...] 非空，done/freeze 为 null

# 3. 顺带读走该主题的上下文提示词（这是理解任务的背景，不是可选项）
nx-kv prompt get <topic> --json

# 4. 完成后回填结果（--ref 是任务**内容**；结果写进该任务的 note，供人和后续 agent 追溯）
nx-kv todo done --ref "<任务内容>" --result "改了什么 / 关键决策 / 遗留问题"
```

**两条的区别**：`--topic` 不带 `--status` 是「全都要」（含历史），
`--status open --topic` 是「只要待办」。收单用后者（省上下文），
做统计/核对/回顾用前者。

## ⚠️ 定位一律按内容，不按 id（最容易改错数据的地方）

待办的 id **非常容易重复**，两条独立的原因：

1. 分配只扫「待办 + 冻结」，所以任务完成、待办清空后 **id 会被复用**——
   `todo:done` 里因此会积累同 id 的多条（实测某账号 68 条里有 7 条 id=29）。
2. 同一个主题下，内容重复本来就是常态——「修复登录页」这类任务会被反复投递。

所以 `id` 只是**给人看的元数据**（继续分配、继续出现在输出里），
**不是任何命令的入参**。单条操作一律用 `--ref <内容>`：

```
$ nx-kv todo get --ref "旧记录"
错误: task「旧记录」命中 3 条，无法确定是哪一条。用 --pick <n> 选择：
  [0] done   qus   2026-08-15T15:09:00.097123
  [1] done   qus   2026-08-22T10:40:12.469526
  [2] done   fr    2026-08-30T10:36:25.731238

$ nx-kv todo get --ref "旧记录" --pick 2      # 按编号选
$ nx-kv todo get --ref "旧记录" --topic fr    # 或按主题收窄
```

同一规则适用于 `get` / `update` / `remove` / `done` / `freeze` / `unfreeze`。
`update` 用 `--match-topic` 消歧（`--topic` 在那里表示「改成这个主题」）。
**内容含空格时要加引号**（`--ref "修复登录页 500"`）——`--ref` 是普通 flag，值不会自动吃掉后面的 token。

## 与 kvcli 的关系

两者对接同一后端、同一份数据，可以混用（`kvcli auth login` 与 `nx-kv auth login` 各自存 token）。
差异：

- nx-kv 覆盖全部四把 key（`todo:freeze` / `todo:topics`），kvcli 只管 open / done
- nx-kv 有 Web 面板：`nx-kv serve`
- nx-kv 单条操作按**内容**定位（`--ref`），kvcli 的 `done` 只在 open 里按 **id** 匹配
  —— 而 id 会被复用，所以 kvcli 那套在 done 上定位不安全
- **本 skill 的命令一律写 nx-kv**。若环境里只有 kvcli，见 [[todo-commands]] 末尾的对应关系表

## Ref 加载引导

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[agent-workflow]] | 要**领任务/收单**时——按主题拉待办、读上下文、与用户对齐意图、回填结果的完整 SOP | references/agent-workflow.md |
| [[todo-commands]] | 要**敲具体命令**、查退出码/数据结构/避坑时 | references/todo-commands.md |

**不要预先全读**：收单才读前者，查命令才读后者；平时它们不进上下文。
