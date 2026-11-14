# B02 · CLI 速查（按源码 action 表核对，nx-kv 0.53.x）

约定：查询类命令（list / show / status 等）要结构化字段时加 `--json`；
**交付类命令（localtask get / preview）用默认输出**——stdout 就是引擎封装的 context 原文，
不要用 JSON 解析器去读它（`--json` 时 instruction 会被转义成一行；`--xml` 可逐字取该段）。
`timeout` / `blocked` 都是**业务结果**（exit 0）。
不带 `--cwd` 时按进程当前目录定位主题；`--key` 可直接指主题 key。
驼峰别名（`--goalPrompt` 等）只给 HTTP body 用，CLI 一律用连字符写法。

## localtask（任务）

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `localtask get` | `--cwd` `--timeout N` `--no-open` `--param k=v` | **领活**。有活立即领；`--timeout` 显式给定时阻塞到上限（等不到返回 `timeout`） |
| `localtask add` | `--cwd` `--global` `--summary` `--project` `--board` `--duration 2h` `--goal-prompt` `--block-by 12,13` `--gate` `--fork-of` `--fork-kind` | 提交任务。`--project` 决定归属项目并推导落点目录；`--board` 给组（任务才出现在组面板）；`--global` 进共享池（忽略 `--cwd`） |
| `localtask show` | `--id N` | 看单条（只读，**不领取**） |
| `localtask list` | — | 全部主题概览（目录、现状、等待中、待领取数） |
| `localtask done` | `--id N` `--summary "…"` | 标完成；summary 记为本轮终态 + timegoal 日志 |
| `localtask reopen` | `--id N` `--text` `--kind reopen\|comment` `--quote` `--feedback` | **按反馈派生新任务**（新编号、pending）；旧 done 保持 done，链记在 task_links。只给 `--feedback` 时新正文 = 旧正文 + 完成总结 callout + 反馈段 |
| `localtask chain` | `--id N` | 任务链（origin / reopen / comment / current） |
| `localtask update` | `--id` `--text` `--duration` `--goal-prompt` `--clear-goal` `--block-by` `--clear-block-by` `--gate true\|false` | 改正文 / 时间目标 / DAG 依赖 / 闸门（`--text` 仅未领取时） |
| `localtask reorder` | `--id N` `--before-id M` / `--after-id M` | 调序（领指定编号时用） |
| `localtask fork` | `--id N` | 派生一条新任务（原任务的副本 + forkOf 链） |
| `localtask plan` | `--id N` `--to plan\|pending` | 草稿态：`plan` 不进队列（get/wait 领不到），`pending` 转回待领取；只允许 pending ↔ plan 双向切换 |
| `localtask preview` | `--id N` `--text` `--param` | 预览领取交付（零副作用，调模板用） |
| `localtask remove` | `--id N` `--purge` | 软删除；`--purge` 连附件一起删 |
| `localtask remove-many` | `--ids 1,2,3` `--purge` | 批量删 |
| `localtask task restore` | `--id N` | 恢复软删的任务 |
| `localtask attach` | `--id N` + `--path F` \| `--fileId X` \| `--url U` \| `--task N` \| `--ref R` \| `--mdfile F` \| `--folder D`；`--note` `--inline` `--noEmbed` | 加附件/引用。`--folder` 登记目录路径指针（kind=folder，不复制内容）；`--noEmbed` 只登记不改正文 |
| `localtask detach` | `--id N` `--attachment <id>` `--purge` | 摘掉一条附件（`--purge` 连文件） |
| `localtask attachments` | `--id N` | 附件清单（含本地绝对路径） |
| `localtask events` | `--timeout` `--limit` | 事件流（长轮询，面板用） |
| `localtask presence` | — | 谁在等（等待者注册表快照） |
| `localtask prune` | `--all-finished` `--dry-run` | 清理已完成任务 |
| `localtask timegoal-log` | `--id N` | 单条任务的计时日志 |
| `localtask topic add` | `--cwd` `--summary` | 建主题 |
| `localtask topic remove` | `--cwd` / `--key` `--force` | 删主题（等待中需 `--force`） |
| `localtask topic remove-many` | `--keys` `--cwds` `--all` `--force` | 批量删主题 |
| `localtask config` | `--timeout 180` | 目录级等待/交付设置 |
| `localtask wait` | `--cwd` `--timeout` | **兼容别名**，等价 `get --timeout`；新流程不要用 |

## timegoal（时间目标）

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `timegoal check` | `--task task:<topicKey>:<id>` `--summary "…"` | 每轮推进先跑；原文回显提示词，防漂移 |
| `timegoal set` | `--cwd D` `--duration 2h` `--prompt "…"` | 目录级预算（不是单条任务） |
| `timegoal update` | `--cwd` `--duration` `--prompt` | 改预算 |
| `timegoal show` / `list` / `log` | `--cwd` `--task` | 查看 |
| `timegoal clear` / `prune` | `--cwd` | 清除 / 清理 |

## 文件与附件

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `file upload` | `--path F` \| `--content S` `--name` | 落本机附件仓 → `{ fileId, markdown }` |
| `file get` / `file content` | `--fileId X` | 元信息 / 正文 |
| `file orphans` / `file prune` | `--dry-run` | 未被引用的上传：列出 / 回收 |

## 文档库（refs）

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `docs list` | `--external` | 文档清单（`--external` 连外部镜像一起） |
| `docs get` | `--ref <refId>` | 取正文 |
| `docs set` | `--ref` `--body` / `--body-file` `--desc` | 写正文 / 描述 |
| `docs ref add` | `--owner repo\|group\|group_repo` `--repo` `--group` `--desc` | 新建一篇库内文档 |
| `docs ref unbind` | `--ref` `--type` `--repo` `--group` | 摘归属（文档与正文保留） |
| `docs remove` | `--ref` | 删整篇 |
| `docs bindings` | `--ref` \| `--host <repoKey>` \| `--group <groupKey>` | 归属查询：`--host` 只给仓库自己的；`--group` 给组域（组 → 组内 → 仓库） |
| `docs bind` / `docs link` / `docs note-bind` | `--repo`/`--board` `--ref` `--path` `--note` `--tag` `--remove` `--before` `--reset` | 宿主文档集的增删改（`bind` 主篇，`link` 目录补充，`note-bind` 组内描述） |
| `docs attach` / `detach` / `attachments` / `attach-note` | `--ref` + 附件参数 | 文档附件（用法同 `localtask attach`） |
| `docs mdfile` / `mdfiles` / `link-file` | `--attachment` / `--missing` / `--path` | md 文件指针相关 |
| `docs gc` | `--apply` | 清没有正文的 ref（默认只报数） |

## 仓库

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `repo list` | `--type dev\|ref` | 清单 |
| `repo get` / `repo open` | `--id` (id/key/路径) | 详情 / 在文件管理器打开 |
| `repo add` | `--path` `--name` `--remote` `--key` `--type` `--desc` `--notes` `--icon` | 登记仓库 |
| `repo detect` / `repo scan` | `--path` / `--root` `--depth` `--dry-run` | 探测 / 批量扫描补登记 |
| `repo update` | `--id` + 任意可改字段 + `--get-loop on\|off` `--get-loop-minutes N` | 改仓库；`--get-loop-minutes 0` = 不阻塞 |
| `repo remove` | `--id` | 删登记 |
| `repo clone` | `--remote` `--key` `--name` `--depth` | clone 并登记（普通仓库） |
| `repo ref add` / `repo ref clone` | `--path` / `--url` `--name` `--desc` `--board` `--bind` `--no-bind` `--depth` | 登记 / 克隆参考仓库（`--board` 顺手挂组，`--bind` 绑开发仓库） |
| `repo ref sync` / `check` / `of` | `--id` `--all` / — / `--id` | 更新 / 完整性检查 / 这个仓库的参考 |
| `repo ref note` | `--id` \| `--repo` \| `--board` `--note "…"` | 写参考绑定说明（`repo bind` 本身不收 note） |
| `repo bind` | `--id <ref>` `--repo` \| `--board` `--remove` | 绑参考到仓库/组（`--remove` 解绑） |
| `repo bind-topics` | `--repo` `--apply` | 按主题回填绑定（维护用） |
| `repo doc add` / `list` / `remove` | `--id` `--ref` \| `--path` `--note` `--tag` / `--index` | 仓库文档集（主篇 + 附加） |
| `repo knowledge` | `--id` `--md` | 仓库上下文知识（给 agent 读） |
| `repo key set` / `migrate` / `refresh` | `--id` `--key` `--apply` `--all` `--follow` | key 维护 |
| `repo remote` / `remote list` / `remote pick` / `remote check` | `--id` `--url` `--refresh` | remote 相关 |
| `repo export` / `repo import` | `--zip` `--repos` `--boards` / `--file` `--strategy` `--select` `--clone` | 导入导出（`repo import --diff` 先看差异） |

## 项目组（board）

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `board list` / `board get` | — / `--id` | 清单（含成员 + desc + note）/ 单组 |
| `board add` / `board update` / `board remove` | `--name` `--desc` / `--id` … / `--id` | 增删改组 |
| `board note` | `--id <仓库 id\|路径>` `--board <组 id>` `--note "…"` | 仓库在组内的角色（留空 = 清除） |
| `board assign` | `--id <仓库>` `--board` `--before` `--remove` | 成员增删 / 排序 |
| `board prefix` / `board rekey` / `board prune` | `--prefix` / `--from --to` / `--apply` | key 前缀、重命名、清理 |

## 系统

```bash
nx-kv skill list           # 内置 skill 清单（现在只有 nx-kv）
nx-kv skill install nx-kv  # 装到 skills 目录（--to 指定目标）
nx-kv health               # 服务与版本（纯本机）
```

## 常见返回

```jsonc
// get
{ "status":"ok", "task":{ "id":12, "text":"…", "attachments":[…] }, "instruction":"…" }
{ "status":"timeout" }                                                     // 没活
{ "status":"blocked", "reason":"goal_not_reached", "remainingSec":1800 }    // done 被时间目标挡

// list
{ "topics":[ { "key":"…", "name":"…", "cwd":"…", "pending":3, "waiting":true } ] }

// board list
{ "boards":[ { "id":"…", "name":"…", "desc":"…", "repos":[ { "id":"…","name":"…","path":"…","note":"…" } ] } ], "unassigned":[…] }

// docs bindings
{ "bindings":[ { "refId":"ref_…", "type":"repo|group|group_repo", "repoKey":"…", "groupKey":null, "desc":"…", "title":"…", "main":true } ] }
```

## 避坑

1. `get` 是领取、`show` 是查看——两个不同子命令，别拿 `show` 当领取。
2. `wait` 不要再用：`get --timeout N` 等价，且只有一条路可维护。
3. `update --text` 在任务被领取后无效（先 `reopen`）。
4. `add --cwd` 是**接收方**目录；`--global` 会忽略它。
5. 追加附件会改写正文，连续操作一律用 `--id` 定位。
6. `docs` 的 ref 没有路径；读文件只有附件。
7. `repo bind` 不收 `--note`，写说明要用 `repo ref note`。
