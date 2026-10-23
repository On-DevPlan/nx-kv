# kv-timegoal · 时序与完整示例

按需加载：只是想看命令的话回到 [[kv-timegoal|SKILL.md]]，不必读这份。
下面给一份能复刻的"3 小时调研 Redis 差距并自迭代实现生产级数据库"任务
完整时序，含可直接抄走的 prompt 模板。

---

## 完整时序（一次 timegoal 循环长什么样）

```
                                 ┌──────────────────┐
                                 │  ~/.nx-kv/        │
                                 │  timegoals.json   │
                                 │  （独立存储）      │
                                 └──────────────────┘
                                          ▲
                                          │ set/update/check/clear
                                          │ 都只读写这一个文件
                                          │
┌─────────┐                               ▼
│  user   │   cli: nx-kv timegoal <...>   ──────►─┐
│ (人)    │                                       │
│         │   web: 时间目标 主题卡里内嵌显示      │  ┌──────────────┐
│         │   （逻辑上无关）                       │  │  nx-kv       │
└─────────┘                                       │  │  timegoal    │
                                                  │  │  module      │
                                                  │  │ （独立模块）  │
                                                  └──────┬───────┘
                                                         │
┌─────────────┐                                           ▼
│   agent     │     cli: nx-kv timegoal set/update/check  （事实源）
│  (LLM)      │     ★ agent 唯一读取指令来源 = check 返回的 prompt 字段
└──────┬──────┘
       │
       │  每一轮：
       ▼
  ┌───────────────────────────────────────────────────────┐
  │  1. nx-kv timegoal check --cwd "$PWD" \                 │
  │        --summary "<本轮现状>" --progress "<完成度/下一步>" │
  │        ↓  拿到 {remainingSec, prompt}                 │
  │  2. 把 prompt 字段当本轮根指令                        │
  │  3. 干活（按 prompt 指令）：                           │
  │     · 调 subagent 调研差距、产出最小补丁 + 测试        │
  │     · 把本轮成果追加到 CHANGELOG.md 与 .timegoal-log.md │
  │  4. 如本轮调研发现 prompt 漏条件：                      │
  │     nx-kv timegoal update --prompt "<V2>" --json       │
  │     （**只换 prompt、截止时间不动**）                   │
  │  5. 回到第 1 步                                        │
  └───────────────────────────────────────────────────────┘
       │
       ▼
  ┌───────────────────────────────────────────────────────┐
  │  拿到的 {reached: true} 那一轮：                       │
  │  · 写完本轮总结                                         │
  │  · 不再开新轮、不再 check（除非写最终总结查 prompt）    │
  │  · 退出本循环                                           │
  └───────────────────────────────────────────────────────┘
```

**关键**：timegoal 循环里**只有 `timegoal` 命令族**，没有 `localtask wait`、
没有别的 nx-kv 命令。可以把它单独跑、可以并行跑——互不感知。

## 完整可抄走的 prompt 模板（"调研 Redis 差距并逼近生产级数据库"）

```text
你是「Redis-compatible 生产级数据库」的迭代研发 agent；目标是用 N 小时
（到 set 的 deadline 为止）持续调研当前项目与开源 Redis 的能力差距，
逐轮修复差距、把改进写到 CHANGELOG.md，并自我迭代本 prompt 让下一轮更高效。

每轮你必须做：
1. 调 subagent（general-purpose）对比「当前项目 + 上一轮改进」与「开源
   Redis 最新稳定版」的能力清单，输出 1-3 个本轮最高 ROI 的差距修复项。
2. 对每项写出最小可工作补丁 + 测试，写完跑测试；失败的子任务要在下一轮
   优先重试。
3. 把本轮成果追加一行到 CHANGELOG.md（格式：「- [YYYY-MM-DD HH:mm] 干了什么」）。
4. 把本轮总结写到 .timegoal-log.md 的同一行尾（每轮一行）。
5. 如果 subagent 给出"prompt 优化建议"：调 `nx-kv timegoal update --cwd "$PWD"
   --prompt "<新版 V(N+1)>"` 把下一轮的 prompt 替换掉。**不要调 set**——
   set 会把已用时间清零。

硬性约束：
- 严禁超过本轮剩余时间预算（remainingSec < 30 时立刻停手、写总结、不开新轮）
- 严禁自己改 deadline；想缩短就 `timegoal clear` 再 `timegoal set`
- 每轮开始时先 `nx-kv timegoal check --cwd "$PWD" --summary "<本轮现状>" --progress "<完成度/下一步>" --json`，
  把返回里的 `prompt` 字段当作本轮根指令；**不要从对话历史里重新拼**——以 store 为准
- 写代码必须随附测试；测试失败的修补不计入本轮成果
```

把这个 prompt 一次性 `timegoal set` 进 store，agent 之后每一轮照着干到点为止。

## 实际跑（手工模拟）

```bash
WORKDIR=/path/to/your-project
cd "$WORKDIR"

# 1. set（时长可写 10800，也可写 5h）
nx-kv timegoal set --cwd "$PWD" --duration 10800 \
  --prompt "..." --json

# 2. 立刻 check：reached:false
nx-kv timegoal check --cwd "$PWD" --summary "刚起步" --progress "刚 set 完" --json

# 3. sleep 6s
sleep 6

# 4. 再 check：注意 elapsedSec 增加
nx-kv timegoal check --cwd "$PWD" --summary "跑了一轮" --progress "继续" --json

# 5. update：只换 prompt，deadline 不动
nx-kv timegoal update --cwd "$PWD" --prompt "V2 改得更简洁" --json

# 6. check：prompt 已是 V2，deadline 仍是 1 小时后
nx-kv timegoal check --cwd "$PWD" --summary "改完 prompt" --progress "继续" --json

# 7. 等到点（或手动改 store）后：reached:true
#   （实操：把 ~/.nx-kv/timegoals.json 里 startedAt 改成 4 小时前）
#   到点后目标立即失效（面板上不再显示），但保留期内 show/check 仍查得到 —— 最后一轮照样能读到 prompt

# 8. 回看每轮日志（现状 / 完成度 / 剩余）
nx-kv timegoal log --cwd "$PWD" --json

# 9. clear
nx-kv timegoal clear --cwd "$PWD" --json

# 全程不曾、也不需调过 localtask / todo / 等任何其它命令族
```

## 常见问题

| 现象                                    | 原因 / 做法                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `reached` 没翻                        | 检查客户端时区或 set 时是否给了 `--duration` 过短（默认下限 60s）          |
| check 报"缺少参数 --summary"          | 每次 check 都要写一条日志，必须带 `--summary` 与 `--progress`             |
| `reached` 翻 true 但 list 里看不到目标  | 到点即失效（活动列表只留未到点的）；保留期内 `show`/`check` 仍查得到，`list --json` 看 `archived` |
| update 报"已经到点失效"                | 目标已失效不可复活；要继续请用 `set` 开新一局（起点从现在重算）    |
| update 失败"主题「X」尚未设置 timegoal" | 先 `set` 再 `update`；`update` 不创建                                  |
| clear 返回"无需清空"                    | 本来就没设过；这是 info 不是 error                                           |
| 想换目录                                | clear 旧的 → set 新的；目录（cwd）是绑定的                                  |
| 想中途换 task queue                     | **与 timegoal 无关**——本模块不参与队列，那是其它事                   |
| 想同时用 localtask 等用户               | **可以同时跑**——两套独立循环、各管各的；timegoal 只关心自身 deadline |

## timegoal 的运行边界

```
timegoal 循环里只有 timegoal 命令族——没有别的 nx-kv 命令参与。

跑 100 轮 timegoal 不需要任何其它机制配合；
反过来，跑别的东西也不需要 timegoal 配合。

  · timegoal 只做两件事：算时间、回显提示词原文
  · 不阻塞任何东西——可以同时跑人机接力、派任务给别的 agent、外部 cron
  · 不需要登录 KV 后端——纯本机
  · 数据落在本机文件（timegoals.json），可由环境变量 NX_KV_TIMEGOAL_STORE 改路径
```

**唯一的交互面**是 CLI 与 web 主题卡上的三个按钮（查看 / 编辑 / 清空），
没有任何隐式联动。
