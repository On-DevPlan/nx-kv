---
name: kv-timegoal
description: 把"AI 持续运行 N 小时（如 3 小时）"任务固化到 nx-kv 里——用 CLI 设置时间目标 + 完整全局提示词，每轮自动回显提示词原文避免长对话里 agent 漂移（防偏移），到点返回 reached:true，agent 据此停手收尾。timegoal 是独立模块（独立 store、独立循环、独立命令族），与 localtask wait 等任何其它机制都没有关系；UI 上嵌入在「本地任务」主题卡里只是为了方便查看，逻辑上完全不依赖。agent 可通过 `timegoal update` 自己迭代提示词、用户也可在 web 端动态编辑（都不重置计时器）。典型用法：设置 3 小时"调研开源 Redis 差距并逼近生产级数据库"任务；每轮调 subagent 找差距、写 CHANGELOG、调 update 改 prompt，调 check 看是否到点。触发词：timegoal、time goal、时间目标、3 小时、两小时、持续运行、定时任务、跑一晚上、强制 N 小时、N 小时任务、self-improve prompt、自我迭代提示词、agent 改自己的 prompt、到点自动结束、到点停手、循环任务、跑完为止、UX prompt 防漂移、防偏移。
---
# kv-timegoal — 把"持续 N 小时任务"固化到 nx-kv

一个带"到期硬出口"的循环：开头一次性 `set`，**完整全局提示词固化进 store**；
每轮调 `check`，**拿到的 `prompt` 字段就是这轮的根指令**（永远从 store 原文回显，
不让 agent 在长对话里漂移）；`reached:true` 那轮**自动停手**，写最终总结退出。

## 怎么用

### 1. 开头 set 一次

```bash
nx-kv timegoal set --cwd "$PWD" \
  --duration 10800 \
  --prompt "<完整全局提示词>" --json
```

- `--duration` 持续秒数，**60-86400**（1 分钟到 24 小时）。例：3 小时 = `10800`
- `--prompt` 完整全局提示词，≤20000 字
- `--cwd` 绑定的目录（缺省用当前目录）；**一个目录一个 timegoal**

返回：

```jsonc
{
  "status": "ok",
  "replaced": false,                       // 之前没设过；已有则 true（会重置起点）
  "goal": {
    "durationSec": 10800,
    "startedAt":  "2026-10-19 20:31:12",
    "deadline":   "2026-10-19 23:31:12",   // = startedAt + duration
    "prompt":     "<完整提示词原文>"        // 已固化
  }
}
```

### 2. 每轮循环

```
每轮开始：
  nx-kv timegoal check --cwd "$PWD" --json
    → { remainingSec, prompt, ... }
    → 把 prompt 字段当作本轮根指令（不要从对话历史里重新拼）

  干活（按 prompt 的指令：调 subagent、写代码、改 CHANGELOG 等）

  写一行本轮总结到 .timegoal-log.md（或 git CHANGELOG.md）

  如本轮调研发现 prompt 漏条件：
    nx-kv timegoal update --cwd "$PWD" --prompt "<新版>" --json
    （只换 prompt，截止时间不动）

  回到本轮开头

拿到的 {reached: true} 那一轮：
  写完本轮总结 → 不再开新轮 → 退出本循环
```

### 3. check 的返回形状

```jsonc
{
  "hasGoal":      true,
  "reached":      false,                       // true 即停手信号
  "elapsedSec":   120,                         // 已用秒
  "remainingSec": 10680,                       // 还剩秒
  "startedAt":    "2026-10-19 20:31:12",
  "deadline":     "2026-10-19 23:31:12",
  "now":          "2026-10-19 20:33:12",
  "prompt":       "<完整提示词原文>",          // ← 这才是该轮的根指令
  "cwd":          "/path/to/workdir",
  "key":          "<目录 key>",
  "name":         "<目录名>"
}
```

边界：

- 没设过 timegoal → `{hasGoal:false, reached:false, prompt:""}`（需先 `set`）
- 到点后 `reached:true`，goal 对象仍在；可继续 `check` 看 prompt，直到 `clear`

## 四条硬规则

1. **一次 `set`，整个循环只看 `check` 的返回。** 不要再从对话历史里拼"原始 prompt"
   —— 长对话里 agent 一定会自己改写、漂移、漏条件。**永远把 `check` 返回的
   `prompt` 字段当作本轮根指令**。
2. **想改 prompt 必须用 `timegoal update`，不要 `set`。** `set` 会**重置起点**
   （一次小迭代把 3 小时清零！）；`update` 保留起点——只换 prompt，或顺带
   `--duration` 调整时长（deadline 相应平移，已用时间仍算数）。
3. **`reached:true` 立刻停手。** 干完手头这步、最后写一遍最终总结到
   `.timegoal-log.md`（或 git CHANGELOG.md），**不再开新轮**；这次循环结束。
4. **每轮结尾必写一行总结**到 `<workdir>/.timegoal-log.md`（或 git CHANGELOG），
   格式自定，目的是"失败也能复盘"：时间 / 干了什么 / 下一步计划。

## 完整命令清单

```bash
nx-kv timegoal set    --cwd <dir> --duration <秒> --prompt "<...>"  # 设/换（新起点）
nx-kv timegoal update --cwd <dir> --prompt "<新版>" [--duration <秒>] # 改提示词/时长（保起点）
nx-kv timegoal show   --cwd <dir>                                   # 仅查（不算时间）
nx-kv timegoal check  --cwd <dir>                                   # 算时间 + 回显 prompt
nx-kv timegoal clear  --cwd <dir>                                   # 清空
nx-kv timegoal list                                                   # 所有有 timegoal 的目录
```

全部命令都支持 `--json`（推荐 agent 用）。

`update` 与 `set` 的区别：

|                    | `set`                      | `update`                       |
| ------------------ | ---------------------------- | -------------------------------- |
| 起点 `startedAt` | **重置**（计时从头算） | **保留**（已用时间仍算数） |
| 时长               | 必填                         | 可选（省略=不变）                |
| prompt             | 必填                         | 必填                             |
| 用途               | 开一局新的                   | 迭代提示词 / 调整时长            |

`update` 改时长时：`deadline = startedAt + 新时长`。

## Web 端操作

面板「本地任务」页有两处入口（都是**纯 UI 便利**，数据与逻辑仍属 timegoal 模块）：

**1. 顶部「时间目标」汇总卡** —— 列出所有目录的 timegoal（包括还没在看板里出现过
的目录）：

- **新建**：填目录 + 时长 + 提示词 → 创建
- **编辑**：改时长 / 提示词；默认**保留计时起点**，勾「重置起点」才从头计
- **清空**：删除该目录的 timegoal
- 状态列显示 `剩 mm:ss` 或 `已到点`，每 1.5s 自动刷新

**2. 主题卡里的 timegoal 行**：

- 已设置 → `时间目标剩余 mm:ss` / `已到点（用时 ...）` +「查看提示词 / 编辑 / 清空」
- 未设置 → 「未设置时间目标」+「设置」（为该目录新建）

时长输入带快捷按钮（30 分钟 / 1 / 2 / 3 / 8 小时）。

## 与其它机制的关系

**没有依赖关系。** timegoal 只做两件事：算时间、回显提示词原文。

- 不调用 `localtask wait`：等不到任务是别的事，与是否到点无关
- 不阻塞任何东西：可以同时跑人机接力、派任务给别的 agent、外部 cron
- 不需要登录 KV 后端：纯本机

你可以把它当成一个独立计时器 + 便签本：`set` 把便签写进文件，`check` 读出来
顺便告诉你还剩多少时间。

## 安装

```bash
nx-kv skill install kv-timegoal
```

要详细时序与一份可抄走的 prompt 模板（"调研开源 Redis 差距并逼近生产级数据库"
那种 3 小时任务的范例），读 `references/workflow.md`（按需加载，不查时序不必读）。
