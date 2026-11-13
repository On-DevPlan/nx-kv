---
name: nx-kv
description: nx-kv 本机任务队列（localtask）的收单与操作 —— 领取任务、确认意图、完成后回填、排队委托、挂起等待、任务附件、时间目标；也覆盖本机仓库登记与文档库（refs）的核心命令。触发词：领取任务、我的待办、看一下我的任务、某主题的任务、本地队列、排给我的任务、收单、先确认再执行、任务队列、localtask、完成回填、标记完成、改任务、任务附件、时间目标、本机仓库、项目组、文档库。凡「提交方 → 本机队列 → agent 消费」这条任务流里 agent 一侧的收单动作，或任何要直接操作本机任务队列 / 文档的命令，都走本 skill。
---

# nx-kv — 本机任务队列 + 命令手册

nx-kv 的清单是**纯本机**的：任务、主题、附件、文档、仓库登记全部在本机 SQLite
（默认 `~/.nx-kv/nxkv.db`），**不需要登录、不访问任何后端**。

> 术语：**主题（topic）**由「工作目录 + 项目组」派生，一个主题一个队列；
> **任务（task）**在主题内用 `id` 寻址。项目组的 CLI 命令名沿用 `board`；
> 文档库叫 `refs`，参考仓库是 `refRepos`。完整词表见仓库 `docs/glossary.md`。

## 先判断你要做哪件事

| 你要做的事 | 读哪份 |
| --- | --- |
| **领任务 / 收单**：get → 读 instruction → 与用户对齐意图 → 完成后 done / 继续 wait | [[agent-workflow]] |
| **查命令**：要敲哪条、退出码、数据结构、避坑 | [[localtask-commands]] |
| **任务带附件**：正文里的图片 / docx 怎么读、怎么落到本机 | 本页「附件」一节 + [[localtask-commands]] |
| **本机仓库 / 项目组 / 参考仓库**：`nx-kv repo ...` / `nx-kv board ...` | [[repo-registry]] |

按需加载，不要一开始就全读进来。提交任务到**另一个**工作目录用 `kv-submit` skill；
守候接力（wait 循环）用 `kv-get` skill。

## 前置

```bash
nx-kv localtask list          # 本机有哪些主题、谁在等待、各有多少待领取
nx-kv health                  # 服务与版本（纯本机）
```

没有登录、没有工作空间切换。主题归属由**当前目录**（或 `--cwd` / `--key`）决定；
面板与 CLI 读的是同一份 SQLite。

## 最常用的六条

```bash
# 1. 领活：有任务立即领走；没有立即返回 timeout（不阻塞）
nx-kv localtask get --json
# → { status:"ok", task:{ id, text, attachments? }, instruction:"…" } 或 { status:"timeout" }

# 2. 等人：阻塞等到下一条任务（本轮最后一步；timeout 是业务结果，exit 0）
nx-kv localtask wait --timeout 30 --json

# 3. 派/排队：向本目录（或 --cwd/--global/--project/--board）投递任务
nx-kv localtask add "正文（Markdown）" --json
nx-kv localtask add "带时间目标的活" --duration 2h --json

# 4. 查看单条（get 是「领取」动词，查看一律用 show）
nx-kv localtask show --id <n> --json

# 5. 完成回填（summary 就是下一轮 agent 能看到的「上轮做了什么」）
nx-kv localtask done --id <n> --summary "改了什么 / 关键决策 / 遗留问题" --json

# 6. 按反馈重开原任务（同号回写，旧态压进 history）
nx-kv localtask reopen --id <n> --text "<改后的正文>" --json
```

**`get` 与 `wait` 的区别**：`get` 立即返回；`wait` 阻塞等人回填，拿到任务或超时之前
不要提前结束本轮。同一目录同一时刻只挂一个 wait。

## 领取到的东西必须读全

- `task.text` = 任务正文（Markdown），**永远读它**；
- `instruction` = 服务端渲染的指令段，**有则必读**，与正文一起构成这一轮的根指令：
  - 项目组上下文（组定位、组介绍、本项目位置、兄弟成员、绑定文档的 `refId`/desc）；
  - ack 完成总结要求（默认「完成后 `localtask done --summary`」）；
  - 附件清单与本地绝对路径；
  - 任务级时间目标的 check 指令。

## 附件：正文里的图片与文档（全本机，零网络）

任务**正文本身**就能带附件——标准 markdown，不发明新语法：

```
修一下首页 logo  ![设计稿](3f2a1b…9c)       ← 图片附件
补充材料见 [需求说明.docx](b71e…04.docx)     ← 其他文件附件
```

`( )` 里是**本机附件仓的 fileId**（32 位 hex，原文件名带后缀时结尾会接 `.<ext>`）。
`http(s)://`、`./x.md` 等普通链接不会被当成附件。

```bash
nx-kv file upload --path <本机文件> --json       # 落本机附件仓，返回 fileId + markdown 片段
nx-kv localtask attach --id <n> --path <本机文件> # 上传并追加到正文
nx-kv localtask attach --id <n> --fileId <fileId> # 追加一个已上传的附件
nx-kv localtask attachments --id <n> --json       # 这条任务引用了哪些附件（含本地绝对路径）
```

**没有「同步」这一步**：上传即落盘，命中即给 `localPath`。agent 直接 `Read` 那个路径，
不必拼 URL、不受网络影响。未命中（文件不在本机仓）时清单会明确提示
「本机附件仓没有这个文件」，不要猜。

未被任何任务/文档引用的上传可用 `nx-kv file orphans` 查看、`nx-kv file prune` 回收。

> ⚠️ 追加附件会**改写正文**：同一条任务连续操作时，用 `--id` 定位（不要用正文内容当 key）。

## 定位与寻址

- 主题内任务用 `id`（`localtask show/done/update/remove --id <n>`）；
- 不带 `--cwd` / `--key` 时按**进程当前目录**定位；
- 跨主题引用用 `"<topicKey>:<id>"`（DAG `--block-by`、任务引用附件等）。

## 时间目标：领取即计时，未到点不许标完成

```bash
nx-kv localtask add "长任务" --duration 2h --goal-prompt "先写测试" --json
```

这种任务被领取时**自动起表**，交付文本里带：

```bash
nx-kv timegoal check --task task:<topicKey>:<taskId> --summary "<本轮现状>"
```

每轮推进先跑一次 check（原文回显提示词，防长对话漂移）。**时间未到不能标完成**——
`localtask done` 会返回业务结果：

```json
{ "status": "blocked", "reason": "goal_not_reached", "remainingSec": 1830,
  "hint": "时间未到，不能标记完成——请派出 sub agent 重新提出新的需求；到点后…再来标完成" }
```

按提示派 sub agent 重提需求，到点（check 返回 `reached:true`）后再 `done`。
目录级 timegoal（`timegoal set --cwd …`）是「这个目录整体跑多久」的预算，不是单条任务的。

## 文档库（refs）：任务上下文的来源

任务 instruction 里只会**内嵌仓库主篇**的正文；其余文档只给 `refId` + `desc`，
需要时用命令取：

```bash
nx-kv docs get --ref <refId> --json      # 取文档正文（按 refId）
nx-kv docs list --json                   # 文档列表
nx-kv docs bindings --host <repoKey> --json  # 这个仓库的文档集
```

ref 本身**不是附件、没有本地路径**：它是一篇库内文档 + 归属（仓库 / 组）与一行 desc。
需要“读文件”的只有附件；需要“读文档”的一律走 `docs get --ref`。

## 队列管理（需要时）

```bash
nx-kv localtask list --json                          # 全部主题：目录、现状、等待中、待领取数
nx-kv localtask update --id <n> --text "<新内容>"     # 改正文（未领取时）
nx-kv localtask reorder --id <n> --before-id <m>     # 调序
nx-kv localtask remove --id <n>                      # 软删除（task restore 可恢复）
nx-kv localtask reopen --id <n> --text "<新正文>"     # 就地重开（并记 history）
nx-kv localtask chain --id <n> --json                # 任务链
nx-kv localtask clone --id <n>                       # 复制一条新任务
nx-kv localtask preview --id <n> --json              # 预览领取交付（零副作用）
nx-kv localtask topic remove --cwd "<目录>" --force  # 删整个主题
nx-kv localtask config --timeout 180                 # 目录级等待/交付设置
```

## 硬规则

1. **同一个目录同一时刻只挂一个 wait**（waiters 是进程内注册表）。
2. **timeout 是业务结果，不是错误**（exit 0）：按「暂时没活」收尾，不要当失败重试。
3. **wait 是本轮最后一步**：拿到任务或超时之前，不要提前结束本轮。
4. **instruction 有则必读**：组上下文 / 附件 / 时间目标 / 收尾要求都是硬约束。
5. **带时间目标的任务不许提前标完成**——被拒绝就按提示派 sub agent 重提需求。
6. **`get` 与 `wait` 不要并发跑**（都在同一队列上抢任务）。

## Ref 加载引导

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[agent-workflow]] | 要**领任务/收单**时——get → instruction → 对齐 → 回填的完整 SOP | references/agent-workflow.md |
| [[localtask-commands]] | 要**敲具体命令**、查退出码/数据结构/避坑时 | references/localtask-commands.md |
| [[repo-registry]] | 要**登记本机仓库 / 查看项目组编排**时——`nx-kv repo ...` / `nx-kv board ...` | references/repo-registry.md |

**不要预先全读**：收单才读前者，查命令才读后者；平时它们不进上下文。
