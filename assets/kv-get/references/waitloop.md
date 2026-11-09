# wait 语义与收尾

`wait` 让 agent 停在某个主题里，等用户回填下一条任务；没有任务时就结束本轮，不要在等待中空转。

## 命令

```powershell
nx-kv localtask wait --summary "<当前在做什么>" --timeout 180 --json
```

- `--summary` 必填，写给用户看的现状（会显示在面板上）。
- `--cwd <目录>` 指定主题；`--timeout` 秒，默认 180、最大 600。
- `--param k=v` 与 `get` 同语义。
- `--no-open` 不打开面板。

## 语义

1. 本目录有 pending 任务：立即领取并返回，等价于一次成功 `get`。
2. 本目录为空：自动去全局共享池领取。
3. 都没有：阻塞到超时、用户取消、或目录时间目标到点。

返回与 `get` 同构：`status`、`key`、`task`、`instruction`、`coversBody`、`attachmentsSync`、`renderWarnings`；超时另带 `timeoutMs`，被取消/到点另带 `cancelled:true` + `reason`。

## 出口

| 情况 | 返回 | 后续 |
|---|---|---|
| 领到任务 | `status:"ok"` | 按 `instruction` 执行 |
| 等到超时 | `status:"timeout"`，退出码 0 | 结束本轮，向用户说明现状 |
| 用户取消 | `status:"timeout"` + `cancelled:true` + `reason` | 同超时 |
| 目录时间目标到点 | 同上（`reason:"goal_expired"`） | 同超时 |

`timeout` 是业务结果，不是命令失败，不要重试刷屏。

## 规则

- 同一主题同时只允许一个 `wait`；不要并发 `get` / `wait`。
- `wait` 是本轮最后一步：先交付手上的活，再进入等待。
- 等期间不要伪造任务、不要用旧任务重复 `done`。
- 用户要立刻结束等待时，由用户执行 `nx-kv localtask cancel --cwd <目录>`（agent 也可在明确授权下执行）。
- 被取消的通知会以 `cancelled` 字段带出，不需要额外轮询。
