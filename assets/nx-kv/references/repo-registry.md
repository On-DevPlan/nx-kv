# 仓库与看板（`nx-kv repo` / `nx-kv board`）

> 归属主文档 [[nx-kv]]。本文件只列命令面；搜索并克隆参考仓库的完整流程见 [[kv-repo]]。

## 何时用

- 查本机登记了哪些仓库、某个仓库在哪、归在哪个看板。
- 登记/扫描开发仓库，维护名称、图标、远程地址。
- 管理参考仓库与看板绑定关系。
- 换机/分享时导出导入布局。

**不做 git 操作**（状态/diff/pull/push 用 `git -C <path> ...` 自己做）；例外只有仓库 clone（`repo clone`）与参考仓库的 clone / sync / check。

## 开发仓库

```powershell
nx-kv repo list [--type dev|ref] --json
nx-kv repo get <id> --json
nx-kv repo add <path> [--name N] [--icon 图标] [--desc "<主篇描述>"] [--notes T] [--remote <url>] [--key <key>]
nx-kv repo update <id> [--path P] [--name N] [--icon 图标] [--notes T] [--remote <url>] [--key <key>] [--get-loop on|off] [--get-loop-minutes 10]
nx-kv repo remove <id>
nx-kv repo open <id>
nx-kv repo scan [root] [--depth 3] [--dry-run]
```

- `--key`：有 `--remote` 时可省略（按 host/owner/repo 归一化）；无 remote 时**必须给**。
- 描述是文档，不是字段：改描述用 `nx-kv repo doc add/remove` 或 `nx-kv docs set`；`repo update --desc` 已废弃，传了会报错。
- `repo scan` 不加 `--dry-run` 会真的登记；探测先用 `--dry-run`。
- `--get-loop on` 让该仓库的 `get` 在没有任务时阻塞等人回填（默认 10 分钟，最多 600 秒）。

## 参考仓库

```powershell
nx-kv repo ref clone <url> [--name N] [--desc D] [--board <看板id>] [--bind <开发仓库>] [--depth 1] [--no-bind]
nx-kv repo ref add <path> [--remote <url>] [--name N] [--desc D]
nx-kv repo ref sync [id] [--all]
nx-kv repo ref check
nx-kv repo ref of [id] --json
nx-kv repo ref note <id> --repo <开发仓库> --note "<在这参考什么>"
nx-kv repo ref note <id> --board <看板 id> --note "<在这参考什么>"
```

- clone 落在 `setting get --gitRepoRoot` 指定的目录；未设置会拒绝。
- `repo ref of`：第一层直接绑定到该仓库的参考，第二层按所在看板列出。
- `repo ref note` 写绑定描述，留空即清除。

## 绑定与看板

```powershell
nx-kv repo bind <ref-id> --repo <开发仓库> [--board <看板 id>]
nx-kv repo bind <ref-id> --remove [--repo x | --board y]
nx-kv board list --json
nx-kv board get <id> --json
nx-kv board add <name> [--desc D]
nx-kv board update <id> [--name N] [--desc D]
nx-kv board note <id> --board <看板 id/key/名称> --note "角色/配合关系/关键路径/关键词"
```

- `--repo` / `--board` 都接受多个值（逗号分隔），描述按关系挂在对应仓库/看板上。
- 看板本身是仓库组；`board note` 管理组内成员描述。

## 布局导出与导入

```powershell
nx-kv repo export [--zip <路径>] [--repos k1,k2] [--boards b1,b2] [--no-unassigned]
nx-kv repo import --diff [file]
nx-kv repo import [file] [--strategy ours|overwrite|duplicate] [--select k1,k2] [--clone all|dev|ref|none]
nx-kv repo clone <remote> --key <占位 key>
```

- 导出只含 key/分组/关系，不含本地路径；换机后靠 remote 重新 clone。
- 导入时「本地未拥有」会保留占位，补齐用 `repo clone --key` 或先建仓库再 `repo key set <id> <key>`。

## 红线

- 不拿 `repo list` 判断有没有未提交改动——它不读 git。
- `repo scan C:\` 会登记大量无关目录；指定项目根并控制 `--depth`。
- `repo bind` 只接受 ref 的 `<id>`；回填时从 `repo ref of` 或 `repo list --type ref` 拿。
- `notes` 只写「这个仓库干什么」，不要当 changelog。
