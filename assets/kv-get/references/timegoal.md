# 时间目标（timegoal）

两层，别混用：

| 层级 | 设置方式 | check 对象 | 日志 |
|---|---|---|---|
| 目录级 | `timegoal set --cwd <目录>` | `timegoal check --cwd <目录>` | `timegoal log --cwd <目录>` |
| 任务级 | `localtask add --duration 2h` / `localtask update --duration 2h` | `timegoal check --task task:<topicKey>:<id>` | `localtask timegoal-log --id <id>` |

## 目录级

```powershell
nx-kv timegoal set --cwd <目录> --duration 2h --prompt "<完整目标提示词>"
nx-kv timegoal update --cwd <目录> --prompt "<新版提示词>" [--duration 3h]
nx-kv timegoal show --cwd <目录>
nx-kv timegoal check --cwd <目录> --summary "<当前现状>" --progress "<完成度/下一步>"
nx-kv timegoal log --cwd <目录>
nx-kv timegoal list
nx-kv timegoal clear --cwd <目录>
nx-kv timegoal prune
```

- `set` 必须同时给 `--duration` 与 `--prompt`（提示词 ≤20000 字，每轮 check 原文回显）。
- `update` 保留起点，不重置计时。
- `check` 的 `--summary`、`--progress` 都必填，各 ≤2000 字，每轮写一条日志。
- 到点自动归档；`prune` 连归档一起清。

## 任务级

- 创建任务时 `--duration`（如 `2h`、`90m`、`5小时`）表示领取即计时；`--goal-prompt` 可附要求。
- 未领取时可以用 `localtask update` 改时长/附加要求（`--clear-goal` 清空）；领取后声明即既成事实，不能再改。
- 领取交付的 `instruction` 会带上完整 check 命令，直接照抄：

```powershell
nx-kv timegoal check --task task:<topicKey>:<任务编号> --summary "<当前现状>" --progress "<完成度/下一步>"
```

- 未到点时 `localtask done` 返回 `goal_not_reached`，带 `remainingSec`，不会写完成。
- 查看每轮记录：

```powershell
nx-kv localtask timegoal-log --id <任务编号> --json
```

返回 `hasGoal`、`seq`、`count`、`duration`、`startedAt`、`deadline`、`entries[]`（`checkedAt`、`elapsedSec`、`remainingSec`、`overtimeSec`、`reached`、`summary`、`progress`）。

## 规则

- check 只是过程记录，不会完成任务；完成仍用 `localtask done --summary`。
- 任务级日志只在 `check` 时产生；任务还没 check 过时 `entries` 为空，不代表功能坏了。
- 目录级到点会让阻塞中的 `wait` 提前以 `timeout` + `cancelled:true` 收尾，按超时处理即可。
