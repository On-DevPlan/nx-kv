# nx-kv 快速启动（给 agent 的安装 SOP）

> **给 agent 的入场券**：本页是一份**可直接执行的 SOP**。任何 agent（WorkBuddy / Claude Code /
> 其它支持 skills 的宿主）拿到本页原文或 raw 地址后，按顺序跑完 0-4 步即可完成
> 「配环境 → 装包 → 装 skill → 启动 → 验收」，全程无需人工干预。
>
> raw 地址：`https://raw.githubusercontent.com/On-DevPlan/nx-kv/main/assets/nx-kv/QUICKSTART.md`

## 你在装什么

**nx-kv = 本机任务队列 + 文档库 + 仓库登记的一体化工具。**一条命令起一个 Web 面板（默认 :7877），
同时提供同构 CLI——面板上的每个按钮，底层都是同一条 CLI 命令，`--json` 即可被 agent 直接消费。
所有数据落本机 SQLite（`~/.nx-kv/`），**不需要登录、不访问任何后端**。

---

## 第 0 步 · 环境检查（缺什么装什么）

```bash
node -v   # 必须 >= 22.13.0（nx-kv 的 engines 硬要求）
npm -v    # 随 node 一起来
```

- **node 缺失 / 版本不够** → 按平台装（agent 自行判断平台与包管理器）：
  - Windows：`winget install OpenJS.NodeJS.LTS`（或 `scoop install nodejs-lts`）
  - macOS：`brew install node`
  - Linux（Debian/Ubuntu）：`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
  - 装完重开 shell 再 `node -v` 复验。
- **pnpm / yarn 都行**（本工具只依赖 node + npm registry）；npm 缺失时 `corepack enable` 或重装 node。

## 第 1 步 · 安装 nx-kv

```bash
npm i -g nx-kv
nx-kv version   # 输出 >= 0.65.0 即成功
```

- 不想全局装：`npx nx-kv serve` 也能直接跑（每次现拉）。
- 装完先用 `nx-kv health` 做一次纯本机健康检查。

## 第 2 步 · 安装 skill 到 agent 用户目录（保证 skill 可访问）

skill 本体随 npm 包一起发布（`assets/nx-kv/`：`SKILL.md` + references + templates）。
把**整个目录**复制进你（agent）的 skills 根目录下、命名为 `nx-kv`：

```bash
# 1) 找到 skill 源（全局装包后）：
SRC="$(npm root -g)/nx-kv/assets/nx-kv"

# 2) 复制到你的 skills 根目录（按宿主选其一； WorkBuddy 用户直接用第一行）：
mkdir -p ~/.workbuddy/skills && cp -r "$SRC" ~/.workbuddy/skills/nx-kv    # WorkBuddy
# mkdir -p ~/.claude/skills    && cp -r "$SRC" ~/.claude/skills/nx-kv    # Claude Code
# 其它宿主：把 <skills根>/nx-kv 指向 $SRC（目录里必须有 SKILL.md）

# 3) 验证（skill 可访问的硬标准）：
head -5 ~/.workbuddy/skills/nx-kv/SKILL.md   # 能看到 name/description 即成功
```

> 没装全局包时也可以直接从仓库拿：
> `git clone --depth 1 https://github.com/On-DevPlan/nx-kv /tmp/nx-kv && cp -r /tmp/nx-kv/assets/nx-kv <你的skills根>/nx-kv`

## 第 3 步 · 启动

```bash
nx-kv serve              # 默认 :7877，自动打开浏览器面板
# 常用开关：
nx-kv serve --port 9000            # 换端口
nx-kv serve --no-open              # agent 环境不弹浏览器（NX_SERVE_NO_OPEN=1 全局等效）
nx-kv serve --auto-exit --idle 300 # 无人使用 300 秒后自动退出（后台挂机友好）
```

启动后：面板 = `http://localhost:7877`；CLI 与面板**同源同构**（面板的每个按钮都是一条 CLI 命令）。
端口上已有本面板时，`serve` 直接复用并打开它，不会重复起进程。

## 第 4 步 · 验收清单（agent 自检）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `nx-kv version` | 输出版本号（>= 0.65.0） |
| 2 | `nx-kv health` | 纯本机健康检查通过 |
| 3 | `nx-kv bootstrap` | 输出版本 + 命令表（聚合上下文） |
| 4 | `nx-kv localtask list --json` | 输出 JSON（空队列也正常） |
| 5 | `head -5 <skills根>/nx-kv/SKILL.md` | skill front-matter 可读 |

---

## 你能用它做什么（能力地图）

| 域 | 能干什么 | 入口命令 |
|---|---|---|
| **任务队列** | 领任务 / 完成回填 / 提交委托 / 按反馈派生下一轮 / 附件（图片文档嵌正文）/ 时间目标（领取即计时，防无限拖延） | `localtask get / done / add`、`timegoal check` |
| **仓库登记** | 登记本机仓库 / 按前缀归组 / 克隆远程仓库并绑定 / 组内描述 | `repo add / clone`、`board prefix / assign` |
| **参考仓库** | 绑定参考仓库到组或单仓库（组内共享） | `repo bind`、`repo clone` |
| **文档库** | 文档（ref）三层宿主（仓库 / 项目组 / 任务链），主篇换位、desc 快速定位、结论回写 | `docs add / set / get --ref / main` |
| **提示词** | 交付提示词的段模板管理（多模板 / 启用 / 编辑 / 回出厂） | `prompt registry`、`prompt template save/activate/delete` |
| **面板** | 上面全部能力的 Web UI（同源同构） | `nx-kv serve` |

**agent 的标准工作循环**（详细 SOP 在 skill 的 A 序列）：
`localtask get` 领活 → 按正文干活 → `timegoal check --task <key> --summary` 打卡 →
`localtask done --id <n> --summary` 回填 → `localtask get` 继续领。

## 故障排查

| 症状 | 处理 |
|---|---|
| `serve` 端口被占 | `nx-kv serve --port 9000`（同端口已有本面板时会直接复用） |
| 面板跨域拒绝 | `--allow-origin <来源列表>` 收紧或放开白名单 |
| 克隆参考仓库被拒 | 参考仓库存储根**不允许 C 盘**：`nx-kv setting set --gitRepoRoot <非C盘路径>` |
| skill 不生效 | 确认 `<skills根>/nx-kv/SKILL.md` 存在；front-matter 的 `name:` 必须是 `nx-kv` |
| 数据在哪 | 全部在 `~/.nx-kv/`（SQLite + 附件仓）；重装/升级不动数据 |
