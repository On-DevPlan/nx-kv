# 仓库上下文登记（`nx-kv repo` / `nx-kv board`）

> 归属主文档 [[nx-rh]] 的「仓库登记」路由。本文件是该场景的完整 SOP 与判定标准。

## 何时进入

- 用户问「这台机器上有哪些仓库 / 某个仓库在哪」
- 需要把某个目录登记为受管仓库，或扫描某目录批量发现仓库
- 需要维护仓库的元信息：名称、描述、备注，或改登记路径
- **需要 git 状态、差异、拉取、推送时不要进这里**——开发仓库不做 git 操作（见下）
- **要搜索并克隆参考项目时用 [[kv-repo-mmx-gitrepo]]**——那是参考仓库的克隆 SOP
- **只查分组与关系（不改动）时用 [[kv-repo]]**——那是仓库组的查询/报告侧

## 边界：git 操作只给参考仓库

仓库模块只维护一份**目录清单**。开发仓库（type=dev）的 git 状态、diff、pull、push、
冲突落地全部不做：git 客户端是无底洞，面板做不出比 IDE 更好的体验，
而半吊子的状态显示比没有更危险（用户会拿它当决策依据）。

要用 git 时直接用它自己：

```bash
git -C <path> status -sb
git -C <path> diff
git -C <path> pull --no-edit
```

唯一的例外是**参考仓库**（type=ref，见下节）：clone / sync / check 三件事由本工具做——
它的价值就是「把远程仓库抓到本机参考并保持新鲜」，不做这个它就没存在意义。

本工具的价值在另一方面：把这些路径**记住并描述清楚**（叫什么、干什么用、归在哪类），
让 agent 下次不必重新问一遍「这个是哪个项目」。

## 数据模型

`~/.nx-kv/repos.json` 的 `repos[]`，一条记录形如：

```json
{
  "id": "r_xxx",
  "name": "ext",
  "path": "D:\\a_js\\js_proj\\br_controller\\ext",
  "desc": "对外扩展模块",
  "notes": "",
  "type": "dev",
  "remote": "git@github.com:me/ext.git",
  "linked": [],
  "addedAt": "…",
  "updatedAt": "…"
}
```

- **id / key / 绝对路径**都能定位仓库（agent 直接给路径或 key 更省事）
- 路径不必是 git 仓库：登记不校验目录内容，也不要求目录存在
- **key 是身份，全局唯一**（2026-10-28）：来自归一化远程地址（`git@c:o/r.git`、
  `https://c/o/r`、`ssh://git@ssh.github.com:443/o/r.git` 归一到同一个
  `c/o/r`），或无 remote 时 `local/<名称>` 兜底，也可 `repo key set` 自定义。
  自定义 key 不跟随 remote 变化；`repo key refresh --all` 扫描 `git remote -v`
  （**SSH 优先**）提示可更新的 key/远程地址，`--apply` 才落盘
- **没有标签**：分组只走看板一条路（2026-10-24 废除仓库 tags，两套平行分组只会打架）
- **type 双态**：`dev` = 开发仓库（默认），`ref` = 参考仓库（见下节）
- **remote 是稳定 key**：参考仓库必有；开发仓库也建议记（`repo remote <id|path>` 一条命令
  从目录 origin 读来存档）——导出布局时导远程地址而非本地路径，换机导入才 clone 得回来
- **看板的 desc 是领域描述**：写该组仓库的侧重、配合关系（谁是中心/终端）、
  关键路径与搜索关键词——它是给人和 agent 读的上下文，写法约定见 [[kv-repo]]

## 参考仓库（type=ref）：搜索并克隆外部项目

mmx-research-gitclone 的整体吸纳（2026-10-27）：远程 clone 下来学习/参考的仓库与
开发仓库同住中心清单，但统一存放在 `gitRepoRoot`（`nx-kv setting set --gitRepoRoot <非C盘目录>`，
**不设置则 clone 显式拒绝**——绝不默默堆进用户目录）。完整搜索→克隆 SOP 见
[[kv-repo-mmx-gitrepo]]；这里登记命令面的速查：

```bash
nx-kv repo ref clone <url> [--name N] [--desc D] [--board <看板id>] [--bind <开发仓库>] [--depth 1] [--no-bind]
#   clone + 登记 + 绑定一条龙；在开发仓库目录里跑默认自动绑定当前仓库（--no-bind 关掉）
nx-kv repo ref add <path> [--remote <url>]    # 登记一个已存在的 checkout（不 clone；remote 缺省读 origin）
nx-kv repo ref sync [--all] [id|名称|url]     # 同步更新（git pull --ff-only；冲突不自动 merge）
nx-kv repo ref check                          # 完整性检查：目录/.git/origin 一致性 + 绑定死链（零副作用）
nx-kv repo bind <ref> --repo <开发仓库> --board <看板id>    # 绑定（多对多；目标可多个，逗号分隔）
nx-kv repo bind <ref> --remove [--repo x | --board y]       # 摘绑定（都不带 = 清空）
nx-kv repo ref note <ref> --repo <开发仓库> --note "在这参考什么"   # 写/清绑定描述（board 同理；留空=清）
nx-kv repo ref of [id|路径]                                 # 分层查询：第一层直接绑定，第二层按看板命名空间
nx-kv repo remote <id|path> [--url <地址>]    # 登记远程地址（无 --url = 从目录 origin 读）
```

- **remote 是参考仓库的唯一 key**：同一远程地址（SSH/HTTPS 写法不同也算同源）只允许一条登记
- **linked 挂绑定关系（多对多）**：`[{kind:'repo'|'board', id, note?}]`——一个 ref 可服务
  多个仓库/组，一个仓库/组可挂多个 ref；`note` 是**绑定描述**（这个参考在该仓库/看板里
  参考什么，挂在关系上、摘绑即清，与看板组内描述 board.note 同一哲学）；
  删开发仓库/删看板会同步摘指向它们的绑定，`ref check` 也能查出死链
- **分层查询**：`repo ref of [id|路径]`（缺省当前目录）——第一层 = 直接绑定到该仓库的 ref，
  第二层 = 它所在看板（命名空间）上的 ref 按组列出；agent 问「做这个仓库的事有什么参考」
  用这一条命令就够
- **布局导入导出 v3**（换机/分享整套环境）：

```bash
nx-kv repo export                                   # 全局 key + 分组 + 参考关系（不含本地路径）
nx-kv repo export --zip /path/layout.zip            # 打包成 zip（layout.json + README）
nx-kv repo export --repos <key1,key2> --boards <board/k1>   # 只导出一部分

nx-kv repo import --diff <file>                     # 差异检查（零副作用）：新增/有差异/一致/本地未拥有
nx-kv repo import <file> --strategy ours            # 保留本地（默认）
nx-kv repo import <file> --strategy overwrite       # 用导入文件覆盖（key 不变）
nx-kv repo import <file> --strategy duplicate       # 另存 key-import-1/2/3，两条并存
nx-kv repo import <file> --select <key1,key2> --clone ref   # 只处理选中的，并克隆参考仓库
```

面板：仓库页 →「参考仓库」面板 →「导入导出」→ 全屏面板（左右两栏，逐条勾选 +
冲突方案 + 克隆选项）。「本地未拥有」的条目会显示 key，有远程地址的可在导入时克隆，
纯自定义 key 的需自行在仓库里创建后重跑 diff。


## SOP

### 1. 看清单

```bash
nx-kv repo list                 # 人读表格
nx-kv repo list --json          # 程序消费
```

### 2. 登记

```bash
nx-kv repo add <path> [--name N] [--desc D] [--notes T]
```

- `name` 缺省取目录名
- 同一路径重复登记会显式报错（非零退出），不会产生重复记录

### 3. 批量发现

```bash
nx-kv repo scan [root] [--depth 3] [--dry-run]   # 不带 --dry-run 会真的全部登记
```

- 递归查找含 `.git` 的目录（目录或文件都算——worktree / submodule 下是文件）并登记；已登记的自动跳过
- 默认跳过 `node_modules` / `dist` / `build` / `target` / `.venv` / `vendor` / `AppData` 等
- 深度默认 3；根目录本身也会被检查
- **只做文件系统存在性检查，不调用 git**，所以在没装 git 的机器上同样可用

### 4. 看单条 / 改元信息

```bash
nx-kv repo get <id|path> [--json]
nx-kv repo update <id> [--name N] [--desc D] [--notes T] [--path P]
```

- `update --path` 用来纠正登记错位的目录；改到**已被别的记录占用**的路径会显式报错

### 5. 打开目录

```bash
nx-kv repo open <id>     # 在系统文件管理器打开（Windows: explorer）
```

### 6. 注销

```bash
nx-kv repo remove <id>   # 只移除登记，磁盘文件不受影响
```

## 正反例

| 反例 | 问题 | 正例 |
| --- | --- | --- |
| 用 `repo list` 判断仓库有没有未提交改动 | 这里没有 git 信息，只会得到误导性结论 | 用 `git -C <path> status -sb` |
| 用 `repo scan C:\` 全盘扫 | 极慢且登记大量无关目录 | 指定项目根 + 合理 `--depth` |
| 拿 `repo scan` 当「看看有什么」 | 它会**真的全部登记**，几十条 desc 为空的记录立刻淹掉清单 | 探测用 `repo scan --dry-run`（只列出、零副作用），挑完再逐个 `repo add --desc` |
| 把 `notes` 当 changelog 写 | 元信息越滚越长，列表失去可读性 | 只记「这个仓库是干什么的 / 在哪个生态里」 |

## 失败排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `repo 不存在: <id>` | id 写错或未登记 | 先 `repo list` 拿 id，或直接传绝对路径 |
| `该路径已登记` | 同一路径已有记录 | 用 `repo list` 找到那条，改用 `repo update` |
| `path 不能为空` | `repo add` 少了路径参数 | 补上绝对路径 |
