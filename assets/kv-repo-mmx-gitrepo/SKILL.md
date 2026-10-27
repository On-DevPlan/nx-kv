---
name: kv-repo-mmx-gitrepo
description: 深度搜索（mmx）并克隆开源项目为 nx-kv 的「参考仓库」——替代 mmx-research-gitclone 的散装流程（裸 git clone + .claude/www/git.remote 文本清单），落地为登记表：remote 为 key、统一存放 gitRepoRoot（用户自设非 C 盘目录）、可绑定到当前开发仓库或看板、可同步更新与完整性检查。当用户想要搜索技术资料、调研开源项目、查找最佳实践并克隆参考时触发。例如："搜索Flutter liquid glass实现并clone"、"调研某个技术的开源方案"、"找几个参考项目"。保留 mmx 的既有纪律：3-5 路并行深搜、最多 clone 2 个最有价值的项目、SSH 优先失败双向回退、--depth 1 浅克隆。
---

# kv-repo-mmx-gitrepo — 搜索并克隆参考仓库（nx-kv 登记）

与旧 mmx-research-gitclone 的区别只有**落地方式**：不再裸 `git clone` 到项目里的
`.claude/repo/`、不再 append `.claude/www/git.remote` 文本清单。clone 改走
`nx-kv repo ref clone`——落盘到统一的 gitRepoRoot、写进登记表（remote 为唯一 key）、
顺手绑定到当前开发仓库或看板。换机/同步/查重/检查都由 nx-kv 接管。

## 前置（首次必查一次）

```bash
nx-kv setting get
# → 看 gitRepoRoot；未设置（提示文案里是「未设置」）则问用户要一个目录，然后：
nx-kv setting set --gitRepoRoot <用户给的非C盘目录>
```

- **绝不默默落进默认目录**：gitRepoRoot 不设置，clone 会被显式拒绝——这是刻意的。
- 用户已设置则直接用，不要每次都问。

## SOP

### 1. 深度搜索（mmx，3-5 路并行）

```bash
mmx search query --q "<技术方向> github implementation 2025" --output json --quiet
mmx search query --q "<技术方向> fragment shader implementation code" --output json --quiet
mmx search query --q "<技术方向> pub.dev package widget 2025" --output json --quiet
mmx search query --q "<技术方向> best practice example tutorial" --output json --quiet
```

筛选标准：stars 高、最近更新、与需求最匹配、有真实代码实现。**最多 clone 2 个**。

### 2. 核实仓库存在，不猜 URL

```bash
gh api repos/<owner>/<repo> --jq '.full_name'          # 已知 owner/repo：404 就换目标
curl -s https://registry.npmjs.org/<pkg> | grep -o '"repository":{[^}]*}'   # npm 包反查源仓库
```

无 repository 字段 = 未开源，放弃。

### 3. 克隆 + 登记 + 绑定（一条命令替代旧的三步）

```bash
# 在开发仓库目录里跑（推荐）——自动绑定当前目录的开发仓库
nx-kv repo ref clone <url> --desc "一句话：它参考什么"
# 显式控制：
nx-kv repo ref clone <url> --desc "…" --board <看板id> --bind <开发仓库id|路径|名称> --depth 1
# 只想登记、不自动绑当前仓库：
nx-kv repo ref clone <url> --no-bind
```

- SSH 优先、失败自动回退 HTTPS（双向都试），登记的是实际成功的那条 URL；
- 同一远程地址（SSH/HTTPS 写法不同也算同源）已登记 → 显式报错提醒，不会重复 clone；
- gitRepoRoot 下同名目录已存在且同源 → 提示用 `repo ref add` 登记即可。

### 4. 验证

```bash
nx-kv repo ref check              # 目录/.git/origin 一致性 + 绑定死链，零副作用
nx-kv repo list --type ref --json # 刚 clone 的应该在列，带 remote 与 linked
```

check 全 ✓ 即完成；有 ✗ 按提示处理（目录缺失 → 重 clone；origin 不一致 → 核对后
`repo remote <id> --url <真实地址>` 纠正）。

### 5. 事后维护

```bash
nx-kv repo ref sync --all         # 参考仓库批量更新（git pull --ff-only，冲突不自动 merge）
nx-kv repo bind <ref> --repo <开发仓库> --board <看板id>   # 补绑/多绑
nx-kv repo bind <ref> --remove --repo <开发仓库>           # 摘某条绑定
```

## 输出格式

```
## 搜索结果总结

已克隆为参考仓库（gitRepoRoot: <根目录>）：

1. [项目名](github链接) - stars数
   - 主要功能 / 技术栈
   - nx-kv 登记: <id>，绑定: <开发仓库/看板>

2. …（最多 2 个）

检查: nx-kv repo ref check → N ✓ / 0 ✗
```

## 边界

- 本 skill 只管**参考仓库**（type=ref）；开发仓库的 git 状态/diff/push 一律找 git 自己。
- 旧 `.claude/repo/` 里的存量参考仓库不迁移不删除——要用时
  `nx-kv repo ref add <path>` 登记进来（remote 缺省读目录 origin）。
- 数据按本机 config 存储（~/.nx-kv/），跨机器搬运用 `repo export` / `repo import`
  （导出的是远程地址 + 分组 + 参考关系，不含本地路径）。
