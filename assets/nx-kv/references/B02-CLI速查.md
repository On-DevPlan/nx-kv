# B02 · CLI 速查

约定：所有命令都支持 `--json`（结构化输出，agent 一律加它）；`timeout` / `blocked`
都是**业务结果**（exit 0）。不带 `--cwd` 时按进程当前目录定位主题。

## localtask（任务）

| 命令 | 作用 |
| --- | --- |
| `localtask get [--timeout N] [--cwd D] [--param k=v]` | **领活**：有活立即领；`--timeout` 显式给定时阻塞到上限（等不到就 `timeout`） |
| `localtask add "<文本>" [--cwd D] [--global] [--duration 2h] [--goal-prompt …] [--summary …]` | 提交/排任务 |
| `localtask show --id N` | 看单条（只读，不领取） |
| `localtask list [--json]` | 全部主题概览：目录、现状、等待中、待领取数 |
| `localtask done --id N --summary "…"` | 标完成（summary 必填） |
| `localtask reopen --id N [--text …] [--kind reopen\|comment]` | 就地重开（同号回写 + history） |
| `localtask chain --id N` | 任务链（origin / reopen / comment / current） |
| `localtask update --id N --text "#…"` | 改正文（仅未领取时） |
| `localtask reorder --id N --before-id M` | 调序（领指定编号时用） |
| `localtask remove --id N` / `localtask restore` | 软删除 / 恢复 |
| `localtask clone --id N` | 复制成新任务 |
| `localtask preview --id N` | 预览领取交付（零副作用，调试模板用） |
| `localtask attach --id N --path F\|--fileId X` | 追加附件 |
| `localtask attachments --id N` | 附件清单（含本地绝对路径） |
| `localtask config --timeout 180` | 目录级等待/交付设置 |
| `localtask topic remove --cwd D [--force]` | 删整个主题 |
| `localtask wait [--timeout N]` | **兼容别名**，等价 `get --timeout`；新流程不要用 |

## timegoal（时间目标）

| 命令 | 作用 |
| --- | --- |
| `timegoal check --task task:<topicKey>:<id> [--summary …]` | 每轮推进先跑；原文回显提示词，防漂移 |
| `timegoal set --cwd D --duration 2h` | 目录级预算（不是单条任务） |
| `timegoal list` / `timegoal clear` | 查看 / 清除 |

## 文件与附件

| 命令 | 作用 |
| --- | --- |
| `file upload --path F` | 落本机附件仓 → `{ fileId, markdown }` |
| `file orphans` / `file prune` | 未被引用的上传：列出 / 回收 |

## 文档库（refs）

| 命令 | 作用 |
| --- | --- |
| `docs get --ref <refId>` | 取正文 |
| `docs list [--json]` | 文档清单 |
| `docs bindings --host <repoKey>` | 仓库自己的文档集（type=repo） |
| `docs bindings --group <groupKey>` | 组域：组 → 组内仓库 → 仓库自己 |
| `docs gc [--apply]` | 清没有正文的 ref（默认只报数） |

## 仓库与项目组

| 命令 | 作用 |
| --- | --- |
| `repo list` / `repo get <id\|key\|路径>` | 清单 / 单仓库详情 + 所在组 |
| `repo add --path D --name N [--remote URL]` | 登记仓库 |
| `repo update <id> [--name …] [--desc …] [--get-loop on] [--get-loop-minutes N]` | 改仓库 / 开持续 get |
| `repo scan` | 扫描目录补登记 |
| `repo ref clone <url>` / `repo ref sync` / `repo ref check` | 克隆参考仓库 / 更新 / 完整性检查 |
| `repo bind <ref-key> --board <组id> [--note …]` / `--repo <仓库key>` | 参考绑定（组级 / 仓库级） |
| `board list` / `board get <id>` | 组清单（含成员 + desc）/ 单组 |
| `board add --name N [--desc …]` / `board update` / `board remove` | 增删改组 |
| `board note <仓库\|路径> --board <组id> --note "…"` | 仓库在组内的角色描述（留空 = 清除） |

## skill / 系统

```bash
nx-kv skill list [--json]              # 内置 skill 清单
nx-kv skill install <name> [--to DIR]  # 装到 skills 目录
nx-kv health                           # 服务与版本（纯本机）
```

## 数据结构（常见返回）

```jsonc
// get
{ "status":"ok", "task":{ "id":12, "text":"…", "attachments":[…] }, "instruction":"…" }
{ "status":"timeout" }                       // 没活
{ "status":"blocked", "reason":"goal_not_reached", "remainingSec":1800, "hint":"…" }  // done 被时间目标挡

// list
{ "topics":[ { "key":"…", "name":"…", "cwd":"…", "pending":3, "waiting":true, "status":"…" } ] }

// board list
{ "boards":[ { "id":"…", "name":"…", "desc":"…", "repos":[ { "id":"…","name":"…","path":"…","note":"…" } ] } ], "unassigned":[…] }
```

## 避坑

1. `get` 是「领取」动词，**查看一律用 `show`**（两者是不同子命令）。
2. `wait` 别再用：`get --timeout N` 等价，且只有一条路可维护。
3. `update --text` 在任务已被领取后无效（先 `reopen`）。
4. `add` 的 `--cwd` 是**接收方**目录，不是自己的。
5. 追加附件会改写正文，连续操作一律用 `--id` 定位。
6. `docs` 的 ref 没有路径，别拿它当文件读。
