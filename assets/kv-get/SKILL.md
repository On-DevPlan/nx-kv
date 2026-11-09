---
name: kv-get
description: 领取并完成排给自己的本地任务：get 领活、wait 等人回填、timegoal check 门禁、done 回调总结。任务在某个工作目录的队列里，按队列顺序执行。
---

# kv-get — 领取与完成本地任务

按需读：

- [[localget]] —— 队列管理：list / show / add / update / remove / reorder / clone / fork / close-many
- [[waitloop]] —— wait 的语义、出口与收尾要求
- [[timegoal]] —— 时间目标：目录级目标、任务级 check、日志

## 1. 领取任务

```powershell
nx-kv localtask get --summary "<当前在做什么>" --json
```

- `--cwd <目录>`：指定主题（默认当前目录）。
- `--summary <文本>`：现状，必填于 `wait`、可选于此。
- `--timeout <秒>`：最多等多久。
- `--param k=v`：可重复，作为模板参数进入交付上下文。
- `--no-open`：不要在浏览器打开面板。
- `get` 是“领取”，不是“查看”。查看用 `localtask show --id <n>`。

行为：

- 有任务：立即领取，返回 `status:"ok"`。
- 本目录与全局池都为空、且项目「持续 get」关闭：立即返回 `status:"timeout"`（退出码 0，这是业务结果，不是错误）。
- 项目开启「持续 get」后，`get` 会像 `wait` 一样阻塞到项目窗口（默认 10 分钟，最多 600 秒）。
- 本目录没任务时自动去全局池领。

返回（`--json`）：

```json
{
  "status": "ok | timeout",
  "key": "topicKey",
  "cwd": "D:\\work\\demo",
  "name": "队列名",
  "summary": "队列现状",
  "repo": { "key": "...", "name": "..." },
  "task": { "id": 79, "text": "...", "status": "claimed", "timegoal": null },
  "instruction": "timecheck / ext / ack 等附加提示",
  "coversBody": false,
  "attachmentsSync": { "dir": "...", "downloaded": 2, "skipped": 0, "failures": [] },
  "renderWarnings": [],
  "queued": true,
  "source": "local | global"
}
```

- **任务正文在 `task.text`**，必须读；`instruction` 是附加提示（时间目标 check、队列后续、收尾要求），不是正文。
- `coversBody:false` 明确表示 `instruction` 没带正文，只看 `instruction` 会漏需求。
- `renderWarnings` 非空说明某块模板回落了内置模板，任务仍可执行。
- `delivered:true` 只在提交进程内正好有 `wait`、当场送达时出现；默认是 `queued:true`。
- `getLoop` 只在项目开启持续 get 时出现。

## 2. 附件怎么取

领取载荷里的 `task.attachments` 与专门命令都会给出附件列表：

```powershell
nx-kv localtask attachments --id 79 --json
```

条目字段：`id`、`kind`、`name`、`area`（`inline`=正文内嵌 / `area`=附件区）、`localPath`、`url`、`target`、`storage`、`synced`。

按 `kind` 取：

| kind | 怎么取 |
|---|---|
| `file` / `image` | 有 `localPath` 直接读；没有则 `nx-kv file sync --ids <id>` 拉回本地再读 |
| `url` | 直接访问 `url` |
| `task` | 直接用条目里的 `cmd`（即 `nx-kv localtask show --id <seq> --key <topicKey>`）读最新正文 |
| `ref` | 直接用条目里的 `cmd`（`docs get path:<绝对路径>` 或 `rel:<相对路径>`）读文档 |

- 附件同步由设置项 `autoSyncAttachments` 控制；开启时 `get` 会尽量把可下载的附件落到本地，失败逐条见 `attachmentsSync.failures`。
- 正文内的 `inline` 附件要按正文位置读；`area` 附件是补充材料，可只读任务需要的部分。

## 3. wait（等人回填）

```powershell
nx-kv localtask wait --summary "<当前在做什么>" --timeout 180 --json
```

- `--summary` 必填。默认等 180 秒，最大 600 秒。
- 本目录没任务时自动领全局池。
- 出口：
  - `status:"ok"`：领到任务，读 `task.text` + `instruction` 后继续；
  - `status:"timeout"`：时间到，退出码 0；
  - 带 `cancelled:true` + `reason`（如 `goal_expired`）：等待被目录时间目标到点或用户取消提前收尾，同样按 timeout 处理。
- 同一主题同时只允许一个 `wait`；`wait` 是本轮最后一步，等完再结束本轮。
- 用户需取消等待时用 `nx-kv localtask cancel --cwd <目录>`。

## 4. 完成与总结

```powershell
nx-kv localtask done --id 79 --summary "<完成总结>" --progress "<完成度 / 下一步>"
```

- `--id` 必填；`--summary` 必填；`--progress` 可选。
- 返回 `status:"ok"`、`completed`、`feedback`、`goal`；重复提交返回 `already:true`，幂等。
- 被拒时返回 `status:"blocked"` + `reason`：
  - `not_claimed`：任务不在你手上，先 `get`；
  - `goal_not_reached`：任务级时间目标未到点，按返回里的 `remainingSec`/提示处理（可派子 agent 继续干或等到点），不要伪造。
- 完成总结会被记入任务，供下一轮/重开时查看。

## 5. 重开与关闭

```powershell
nx-kv localtask reopen --id 79 --kind reopen --feedback "<反馈>"
```

- 现在按「派生新任务」实现：新任务为 `pending`、轮次 +1，正文为旧正文（可加反馈段）；旧任务若已 `done` 保持 `done`，若 `pending`/`claimed` 变为 `cancelled` 并记录 `supersededBy`。
- 不会把原任务改回 `pending`，也不会复用原编号。

```powershell
nx-kv localtask close-many --ids 12,13 --status done --summary "<统一总结>"
```

- 用户侧批量收口；`--ids` 必填（逗号分隔或给多次），`--status done|cancelled`，`--summary` 在 done 时可省略。
- 返回 `count`、`closed`、`skipped`、`missing`；跳过原因会给出（如非 pending）。
- 没有单条 `localtask close`；自己领的任务用 `done` 收尾。

## 6. 时间目标（timegoal）

- 任务带时间目标时，领取交付里已有 check 命令，形如：

```powershell
nx-kv timegoal check --task task:<topicKey>:79 --summary "<本轮进展>" --progress "<完成度>"
```

- check 只记录过程，不会替你完成任务；到点后 `done` 才放行。任务级日志用：

```powershell
nx-kv localtask timegoal-log --id 79 --json
```

返回 `hasGoal`、`count`、`entries[]`（每轮的 `checkedAt`、`elapsedSec`、`remainingSec`、`overtimeSec`、`reached`、`summary`、`progress`）。
目录级目标与更多说明见 [[timegoal]]。

## 7. 红线

- 不伪造 `done`、不跳过 `timegoal check` 直接硬 `done`。
- 不把 `task.id`（队列内序号）当数据库主键，也不在命令里互换。
- 不在同一目录并发 `get`/`wait`。
- 仅任务级 `timegoal check` 与 `localtask timegoal-log` 适用于本地任务；旧版说明里的 `timegoal attach` / `todo` 指的是别的功能面，不要拿来操作本地任务。
