# 命令手册：localtask（本机任务队列）

> 归属主文档 [[nx-kv]]。先读主文档的「最常用的六条」，这里补细节：
> 参数、返回结构、退出码、避坑。全部命令**纯本机、不需要登录**。

## 通用约定

| 约定 | 内容 |
| --- | --- |
| `--json` | 单个 JSON 值到 stdout，无多余文本；适合 `JSON.parse` |
| 退出码 | `0` 成功；`1` 失败（参数错 / 不存在 / 冲突） |
| 主题定位 | 默认是**进程当前目录**；任意命令可带 `--cwd <目录>`；已有主题可直接 `--key <topicKey>` |
| 任务定位 | `--id <n>`（主题内唯一）；跨主题引用写 `"<topicKey>:<id>"` |
| 数据落盘 | 本机 SQLite（`NX_KV_DB` 可覆盖；默认 `~/.nx-kv/nxkv.db`） |

`get` 是**领取**动词（改状态）；查看一律用 `show`。要预览交付又不领取，用 `preview`。

## 领取 / 等待 / 完成

```bash
# 领活：有任务立即领走；没有立即 timeout（不阻塞）
nx-kv localtask get --json
# → { status:"ok", task:{ id, text, attachments? }, instruction:"…" }
#   或 { status:"timeout", ... }（exit 0，正常业务结果）

# 等人：阻塞等到下一条任务；本轮最后一步
nx-kv localtask wait --timeout 180 --json
# → 同上；超时返回 { status:"timeout", timeoutMs, ... }

# 只读查看单条
nx-kv localtask show --id <n> --json

# 完成回填（summary 必填；时间目标未到点会 blocked）
nx-kv localtask done --id <n> --summary "<完成总结>" --json

# 就地重开（同号回写；旧态压进 history）
nx-kv localtask reopen --id <n> --text "<新正文>" [--kind reopen|comment] --json
```

`done` 被时间目标拒绝时返回（不是错误）：

```json
{ "status": "blocked", "reason": "goal_not_reached", "remainingSec": 1830,
  "hint": "时间未到，不能标记完成——请派出 sub agent 重新提出新的需求；到点后…再来标完成" }
```

`wait` 的 timeout 返回形状是固定契约：`cwd` / `key` / `status` / `summary` / `timeoutMs`。

## 投递 / 排队

```bash
nx-kv localtask add "<Markdown 正文>" --json
nx-kv localtask add "<正文>" --cwd <目录> --json
nx-kv localtask add "<正文>" --global --json          # 全局共享池
nx-kv localtask add "<正文>" --project <仓库> --board <组> --json
nx-kv localtask add "<正文>" --duration 2h --goal-prompt "先写测试" --json
nx-kv localtask add "<正文>" --block-by 12,13 --json # DAG：这些任务完成后才可领
nx-kv localtask add "<正文>" --gate --json           # 闸门：本任务未完成，后面的 pending 不可领
```

投递到别的目录的完整「委托」流程见 `kv-submit` skill（它会把上下文与验收标准
打包成自包含任务再 `localtask add`）。

## 队列与主题管理

```bash
nx-kv localtask list --json                         # 全部主题总览
nx-kv localtask update --id <n> --text "<新内容>"    # 改正文（未领取时）
nx-kv localtask update --id <n> --duration 90m      # 设/改任务级时间目标
nx-kv localtask update --id <n> --clear-goal        # 清时间目标
nx-kv localtask reorder --id <n> --before-id <m>    # 调序
nx-kv localtask remove --id <n>                     # 软删除
nx-kv localtask task restore --id <n>               # 恢复软删除
nx-kv localtask clone --id <n>                      # 复制为新任务
nx-kv localtask chain --id <n> --json               # 任务链（history + fork）
nx-kv localtask cancel --cwd <目录>                 # 取消该主题的等待（无等待则 no-op）
nx-kv localtask topic add --cwd <目录>              # 建主题
nx-kv localtask topic remove --cwd <目录> --force   # 删主题（有未领取任务默认拒绝）
nx-kv localtask topic remove-many --keys <k1,k2> --force
nx-kv localtask prune --days 30 --json              # 清理旧终态任务
```

## 附件（全部本机）

```bash
nx-kv file upload --path <本机文件> --json
# → { fileId, name, size, contentType, storage:"local", localPath, markdown:{image,file} }

nx-kv localtask attach --id <n> --path <本机文件> --json      # 上传并嵌入正文
nx-kv localtask attach --id <n> --fileId <fileId> --json      # 引用已有附件
nx-kv localtask attach --id <n> --fileId <id> --no-embed      # 只挂附件区，不写正文
nx-kv localtask attach --id <n> --url <https://…>             # 外链资源
nx-kv localtask attach --id <n> --ref <refId> [--inline]      # 文档绑定（--inline 交付带全文）
nx-kv localtask attach --id <n> --mdfile <本机 .md 路径>       # 本地 md 路径指针
nx-kv localtask attach-note --id <n> --attachment <id> --note "<说明>"
nx-kv localtask attachments --id <n> --json                   # 附件清单 + 本地绝对路径
nx-kv localtask detach --id <n> --attachment <id>
```

返回的附件条目形如：

```json
{ "id": "3f2a…9c", "kind": "image", "name": "设计稿.png",
  "storage": "local", "synced": true,
  "localPath": "C:\\Users\\me\\.nx-kv\\attachments\\local\\设计稿.png" }
```

- `synced` = 本机仓命中；`localPath` 是真实在盘的绝对路径，agent 直接 `Read`。
- 未命中时没有 `localPath`，清单会写「本机附件仓没有这个文件」——不要猜路径。
- **没有 `file sync`、没有自动下载开关、没有云端图床**；上传即落盘。

清理无主资源：

```bash
nx-kv file orphans --json       # 没有被任何任务/文档引用的上传
nx-kv file prune --dry-run      # 先看
nx-kv file prune                # 回收（DB 行 + 附件根内的字节）
```

## 时间目标

```bash
nx-kv timegoal set --cwd <目录> --duration 4h --prompt "<根指令>"   # 目录级预算
nx-kv timegoal show --cwd <目录> --json
nx-kv timegoal check --task task:<topicKey>:<taskId> --summary "<本轮现状>" --json
nx-kv timegoal clear --cwd <目录>
nx-kv timegoal list --json
nx-kv timegoal log --cwd <目录> --json
```

- 任务级目标（`localtask add --duration`）**领取即计时**，交付里带 `check` 指令；
- 每轮推进先 `check`（原文回显提示词，防长对话漂移）；
- `done` 在目标未到点时返回 `blocked`；按 hint 派 sub agent 重提需求；
- 目录级目标是「这个目录整体跑多久」，不影响单条任务的 done。

## 预览与诊断

```bash
nx-kv localtask preview --id <n> --json   # 预览领取交付（不领取、不写库、不起计时）
nx-kv localtask events --json             # 队列事件（面板实时刷新同源）
nx-kv localtask presence --json           # 哪些主题有 agent 在等
nx-kv localtask timegoal-log --json       # 本主题的时间目标日志
nx-kv localtask config --timeout 180      # 等待超时与交付模板（目录级设置）
```

## 文档库（refs）

```bash
nx-kv docs list --json
nx-kv docs get --ref <refId> --json       # 取正文（也认 rel:<相对路径>）
nx-kv docs bindings --repo <key> --json   # 仓库绑了哪些文档
nx-kv docs ref add <path-or-…> --desc "<一行简介>"   # 建直接 ref（无本地路径）
nx-kv docs ref unbind --ref <refId>       # 解绑（不删文档）
```

ref 是**库内文档 + 归属**，不是附件、没有本地路径；读取一律 `docs get --ref`。

## 错误与退出码

| 情况 | 退出码 / code | 处理 |
| --- | --- | --- |
| 参数缺失 / 非法 | 1 · `INVALID_INPUT` | 看报错「用法:」；`--json` 时读 `code` |
| 任务 / 主题不存在 | 1 · `NOT_FOUND` | `localtask list` 确认主题与 id |
| 状态冲突（已被领取 / 已完成） | 1 · `CONFLICT` | 语义是「已经是你要的」，跳过即可 |
| 时间目标未到点 | 0 · `{status:"blocked"}` | 不硬标完成；按 hint 派 sub agent 重提需求 |
| wait 超时 | 0 · `{status:"timeout"}` | 正常业务结果，按「暂时没活」收尾 |

## 避坑

| 坑 | 后果 | 正确做法 |
| --- | --- | --- |
| 用 `get` 当查看 | 改状态、起计时 | 查看用 `show` / `preview` |
| 连续 attach 用正文定位 | 正文被改写，定位漂移 | 一律 `--id` |
| 忘了 `--cwd` | 在别的目录建/领了队列 | 先 `localtask list` 确认主题 |
| 把 timeout 当失败 | 反复重跑，空转 | timeout 是业务结果（exit 0） |
| 并发 `get` + `wait` | 同一队列抢任务 | 同一目录同一时刻只挂一个 wait |
| 提前 `done` 带时间目标的任务 | blocked，白跑 | 到点 `check.reached` 后再 done |
| 附件按 URL 猜 | 本机没有该地址 | 用 `localPath`；未命中就问提交方 |
| 软删除后以为没了 | 任务仍在历史 | `task restore` 可恢复；彻底清理用 `prune` |
