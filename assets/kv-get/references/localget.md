# 队列管理（localget）

面向使用方 agent 的只读/整理用法；命令名与参数以 `node bin/cli.mjs help --json` 为准。

## 查看

```powershell
nx-kv localtask list                     # 全部主题：工作目录、现状、是否等待中、待领取数
nx-kv localtask show --id 79 --json      # 单条任务（正文、状态、时间目标）
nx-kv localtask chain --id 79 --json     # 任务链：nodes[]（轮次、状态、current）、round、derivedFrom、ancestors/children
```

- `show` / `chain` 用 `--cwd <目录>` 或 `--key <topicKey>` 定位主题（二选一；全局池 key 为 `__GLOBAL__`）。
- `show` 只返回任务本体；附件用 `localtask attachments --id <n>` 取，自动下载跟随本机设置。
- `status`：`pending`、`claimed`、`done`、`cancelled`。

## 回填与编辑

```powershell
nx-kv localtask add "<正文>" --cwd <目录>
nx-kv localtask add "<正文>" --global
nx-kv localtask add "<正文>" --project <仓库 key/名称/路径> --board <工作组 id/key/名称> [--duration 2h] [--goal-prompt "<附加要求>"]
nx-kv localtask update --id 79 --text "<新正文>"
nx-kv localtask remove --id 79            # 软删除，可恢复
nx-kv localtask remove --id 79 --purge    # 彻底删除
```

- 正文是**位置参数**，不是 `--text`。
- 有 `wait` 在等时即时投递，否则排队。
- `--global` 推到全局共享池，任何目录的 `wait` 本地空时自动领。
- `--board` 必须同时给 `--project`；任务正文会自动带 frontmatter（`board` + `project` + 双方介绍引用），并落进项目队列。
- `--block-by` 指定前置任务（逗号分隔 id，全部完成后可领）；`--gate` 表示闸门任务（它未完成时后面的 pending 不可领）。
- `--fork-of` / `--fork-kind` 建立派生链（`comment` 默认 / `reopen`）。
- `--duration` 领取即计时，未到点不许 `done`。

## 调整与清理

```powershell
nx-kv localtask reorder --id 20 --before-id 12
nx-kv localtask reorder --id 20 --after-id 13
nx-kv localtask clone --id 79              # 复制正文为新任务，不继承时间目标/依赖
nx-kv localtask fork --id 79               # 复制并挂到源任务链下
nx-kv localtask cancel-many --ids 12,13    # 只取消 pending
nx-kv localtask close-many --ids 12,13 --status done --summary "<总结>"
nx-kv localtask topic add --cwd <目录> [--summary "<现状>"]
nx-kv localtask topic remove --cwd <目录> [--force]
```

- `clone` 开新活；`fork` 保留评论/反馈链，两者别混用。
- `close-many` 的 `--ids` 必填；不要求先领取，已领取/已交付的跳过。
- 删除主题会连同任务一起软删；等待中需 `--force`。

## 等待与取消

```powershell
nx-kv localtask cancel --cwd <目录>        # 立即结束该主题阻塞中的 wait
nx-kv localtask presence                   # 当前打开「实时任务」标签数
```

- `wait` 被取消或目录时间目标到点时，返回 `timeout` 且带 `cancelled:true` / `reason`。
- 同一主题只挂一个 `wait`；需要再等就等上一次收尾后再发起。
