# nx-kv

本机任务队列 + 文档库 + 仓库登记的一体化工具。一个 `npx` 命令起一个 Web 面板，同时提供同构 CLI——
**面板上的每个按钮，底层都是同一条 CLI 命令**，输出 `--json` 即可被任何 agent 直接消费。

所有数据都在本机 SQLite（`~/.nx-kv/nxkv.db`，schema v8），**不需要登录、不访问任何后端**。
附件同样只落本机附件仓；没有云端图床、没有同步开关。

任务正文可以直接**嵌图片与文档**（标准 markdown：`![说明](fileId)` / `[文件名](fileId)`）：

- 图片 / 文件：字节在本机附件仓（`~/.nx-kv/attachments/local/`），交付时直接给绝对路径；
- 文档（ref）：DB 实体（`refs` + `ref_bodies` + `ref_bindings`），有 desc 与归属，没有文件路径。

## 术语（速查）

完整术语以 [assets/nx-kv/SKILL.md](assets/nx-kv/SKILL.md) 为准。

- **主题（topic）**：任务队列容器，由「完整 cwd + 项目组」派生；一个主题只属于一个仓库。
- **本地任务（task）**：`tasks` 行，主题内用 `seq` 编号；生命周期 pending / claimed / done / cancelled。
- **项目组（group）**：`repos.type='group'`；CLI 命令名沿用 `board`，概念名统一为项目组。
- **仓库（repo）**：`repos.type='repo'`，UI 里也叫「项目」。
- **参考仓库（ref repo）**：`repos` 里参考身份的行（store `type=ref`），可绑项目组或仓库；不是文档库。
- **文档（ref）**：`refs` 行 + 正文（`ref_bodies`）+ 归属（`ref_bindings`）；id 是稳定地址，desc 是快速定位。
- **附件（attachment）**：`attachments` 行，kind 为 file / url / task / ref / mdfile。
- **md 文件（mdfile）**：磁盘上的外部 `.md` 路径指针，属于附件逻辑；与文档（ref）是两回事。
- **看板（board）**：项目组的历史别名；CLI / frontmatter 保留，实体名用项目组。
- **提示词区块（block）**：context / attachment / timecheck / goalhint / ext / ack / getloop，共用一份 ctx。

## 快速开始

```bash
pnpm install

# 开发模式（一条命令：vite + 后端一起起，ctrl-c 一起退）
pnpm dev              # vite :5181 + 后端 :7877，/api 自动代理到后端实际端口

# 只想跑其中一半时
pnpm run dev:serve    # 只起后端 :7877
pnpm run vite         # 只起 Vite :5181（等价于 npx vite）

# 生产模式
pnpm start            # 构建 + 起面板

# 校验：lint + 类型检查 + 构建 + 98 项端到端冒烟 + 934 项单元/一致性测试
pnpm test
```

> 代码是 TypeScript（strict）：`pnpm typecheck` 跑 `tsc -b`，
> `pnpm gen` 重新生成 action 清单与前端 typed client（改了 action 声明就要跑）。

冒烟测试全程纯本机（临时目录 + 隔离 DB），不会碰真实用户数据。

`nx-kv serve` 默认会打开浏览器；**端口被占时不会报错退出**：

- 占用者**就是本项目的面板** → 直接复用它（不重复起进程），并打开它；
- 占用者是别的服务 → 顺延到**下一个空闲端口**起自己的面板，并打开它。

`--no-open` 只关这一次；`NX_SERVE_NO_OPEN=1`（`true` / `yes` / `on` 同义）则是**所有 nx-xx 项目共用**的全局开关，设为真值后 `serve` 完全不开浏览器。

### 跨域（内网穿透 / 移动端访问）

面板的写请求**不再按 `Origin` 判定「跨站」并拒绝**。原先那道校验比对 `Origin` 的
主机名是不是 `127.0.0.1`，但浏览器对 POST/PUT/DELETE **一律带 `Origin`**——经内网穿透
（frp / cloudflared / ngrok）从手机访问时 `Origin` 是隧道域名，**自己面板的同源写请求**
也被判成跨站而 403，任务提交不了。

现在的口径：

- 同源请求（含隧道同源）**不预检**，直接放行；
- 跨源请求走标准 CORS：先 `OPTIONS` 预检，服务端回 `access-control-allow-origin` 才放行；
- 非浏览器客户端（curl / 原生 App）不带 `Origin`，本来就不受限。

要收紧来源时用 `--allow-origin`（逗号分隔，支持 `https://*.example.com` 通配；缺省放行全部）：

```bash
nx-kv serve --allow-origin https://panel.example.com
```

> 面板只绑 `127.0.0.1`，是本机工具。**经内网穿透暴露到公网后，真正的边界是隧道自身的
> 访问控制**（访问密码 / basic auth / IP 白名单）——非浏览器客户端从不经过 `Origin` 校验。

## 常用命令

```bash
# 领活：有任务立即领走；没有立即 timeout（不阻塞）
nx-kv localtask get --json
# → { status:"ok", task:{ id, text, attachments? }, instruction:"…" } 或 { status:"timeout" }

# 等人：阻塞等到下一条任务（本轮最后一步；timeout 是业务结果，exit 0）
nx-kv localtask wait --timeout 180 --json

# 查看 / 投递 / 完成 / 重开
nx-kv localtask show --id <n> --json
nx-kv localtask add "正文（Markdown）" --json
nx-kv localtask add "长任务" --duration 2h --goal-prompt "先写测试" --json
nx-kv localtask done --id <n> --summary "改了什么 / 怎么验证 / 遗留问题" --json
nx-kv localtask reopen --id <n> --text "<新正文>" --json
```

`get` 是**领取**动词（改状态、带时间目标会起表）；查看一律用 `show`，要预览交付又不领取用 `preview`。
完整命令表由 action 声明自动生成：`nx-kv help`；命令与 HTTP 端点互相可查：`nx-kv routes`。

## 队列与主题

```bash
nx-kv localtask list --json                       # 全部主题：目录、现状、等待中、待领取数
nx-kv localtask update --id <n> --text "<新内容>"  # 改正文（未领取时）
nx-kv localtask reorder --id <n> --before-id <m>  # 调序
nx-kv localtask remove --id <n>                   # 软删除（task restore 可恢复）
nx-kv localtask chain --id <n> --json             # 任务链（history + fork）
nx-kv localtask topic add --cwd <目录>             # 建主题
nx-kv localtask topic remove --cwd <目录> --force  # 删主题（有未领取任务默认拒绝）
nx-kv localtask prune --days 30 --json            # 清理旧终态任务
```

不带 `--cwd` / `--key` 时按**进程当前目录**定位。同一目录同一时刻只挂一个 `wait`；
`get` 与 `wait` 不要并发跑（都在同一队列上抢任务）。

## 附件（全部本机）

任务正文用**标准 markdown** 引用附件：

```
修一下首页 logo  ![设计稿](3f2a1b…9c)       # 图片
补充材料见 [需求说明.docx](b71e…04.docx)     # 其他文件
```

括号里是本机附件仓的 `fileId`（32 位 hex）。`http(s)://`、相对路径不算附件。

```bash
nx-kv file upload --path "D:\设计\首页.png" --json    # 落本机附件仓，返回 fileId + markdown 片段
nx-kv localtask attach --id 3 --path "D:\doc\需求.docx"  # 上传并嵌入正文
nx-kv localtask attach --id 3 --fileId <fileId>          # 引用已有附件
nx-kv localtask attach --id 3 --url https://example.com  # 外链
nx-kv localtask attach --id 3 --task 7                   # 同主题任务引用
nx-kv localtask attach --id 3 --ref <refId> [--inline]   # 文档绑定（--inline 交付带全文）
nx-kv localtask attach --id 3 --mdfile "D:\doc\方案.md"   # 本地 md 路径指针
nx-kv localtask attach --id 3 --path "D:\doc\需求.docx" --no-embed  # 只挂附件区
nx-kv localtask attachments --id 3 --json                # 清单（含本地绝对路径）
nx-kv localtask detach --id 3 --attachment <id>          # 解除关系
```

**没有 `file sync`、没有自动下载开关、没有云端图床**：上传即落盘，命中即给 `localPath`；
未命中时清单会明确写「本机附件仓没有这个文件」。

清理无主资源：

```bash
nx-kv file orphans --json     # 没有被任何任务/文档引用的上传
nx-kv file prune --dry-run    # 先看
nx-kv file prune              # 回收（DB 行 + 附件根内的字节）
```

## 文档库（refs）

ref 是 DB 实体：`refs`（id / locator / desc / 归属）+ `ref_bodies`（正文）+ `ref_bindings`（挂在哪）。
**没有文件路径，也没有逻辑名**：地址只有 `refs.id`（`ref_<16hex>`）与 `refs.locator`
（外部文件 / URL 的实际位置）；读取一律按 refId：

```bash
nx-kv docs list --json
nx-kv docs get --ref <refId> --json       # 取正文（只认 refId）
nx-kv docs bindings --host <repoKey> --json   # 这个仓库挂了哪些文档
nx-kv docs bindings --group <组> --json   # 这个组挂了哪些文档
nx-kv docs ref add --desc "一句话描述" --owner repo --repo <key>   # 新建直接 ref
nx-kv docs ref unbind --ref <refId>       # 解绑（不删文档）
```

提示词模板只会**自动内嵌仓库主篇**；其余文档给 `refId` + `desc`，由 agent 自己
`nx-kv docs get --ref <refId>` 按需取。`ref.desc` 是快速定位标签，`ref.title` 是正文首行标题。

## 时间目标（timegoal）

把「AI 持续运行 N 小时」这类长任务**固化到工具里**，而不是散落在外部脚本：

```bash
# 目录级：3 小时 + 完整提示词（提示词原文固化）
nx-kv timegoal set --cwd "$PWD" --duration 3h --prompt "<完整全局提示词>" --json

# 每轮调一次：算出还剩多少时间，并原文回显提示词
nx-kv timegoal check --cwd "$PWD" --summary "<当前现状>" --json

# 任务级：领取即计时，未到点 done 会被 blocked
nx-kv localtask add "长任务" --duration 2h --json
nx-kv timegoal check --task task:<topicKey>:<taskId> --summary "<本轮现状>" --json
```

到点（`reached:true`）后再 `done`；未到点被拒绝时按 hint 派 sub agent 重提需求，不要硬标完成。
目录级目标存 `settings.tg.cwd.<topicKey>`，任务级存 `goals` / `goal_checks` 表；两者可同时跑。

## 定位与排错

- 主题内任务用 `--id <n>`；跨主题引用写 `"<topicKey>:<id>"`。
- 不带 `--cwd` / `--key` 时按进程当前目录定位；先 `localtask list` 确认主题。
- `localtask wait` 的 `timeout` 是业务结果（exit 0），不是错误；不要当失败重试。
- 带时间目标的任务未到点 `done` 返回 `{status:"blocked"}`（exit 0），按 hint 处理。
- 详细命令、返回结构、避坑见 [assets/nx-kv/references/localtask-commands.md](assets/nx-kv/references/localtask-commands.md)。

## 架构：action 三端同源

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Web 面板     │   │   agent CLI  │   │  HTTP API    │
└───────┬──────┘   └───────┬──────┘   └───────┬──────┘
        └──────────────────┼──────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  action 声明（每个功能域的 actions/）      │
        │  { cli: [...], http: [...], run, render } │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  service 层（唯一业务真相源）              │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  core：SQLite / 本机附件 / 配置 / 错误     │
        └──────────────────────────────────────────┘
```

**一条 action 同时声明 CLI 命令路径与 HTTP 路由**，二者写在同一处，
所以「Web 上能做的，CLI 都能做」是结构保证而非口头约定。

```
src/core/          零业务语义：db（SQLite） / localatt / filekind / config / errors / paths
src/shared/        同构纯函数：附件语法 / 双链 / frontmatter / 提示词区块——Node 与浏览器加载同一份，零依赖
src/modules/       功能域：system / setting / bundled / db / docs / file / localtask / repos / tasktool / templates
src/runtime/       装配层：registry / spec / cli / api / server
src/web/frontend/  React 壳（视图全在这里，后端不知道它们的路径）
assets/nx-kv/      内置 skill：本机任务 / 文档 / 仓库总手册
assets/kv-get/     内置 skill：领取本目录本地任务
assets/kv-submit/  内置 skill：需求提炼与委托提交
assets/kv-repo/    内置 skill：仓库 / 项目组 / 参考仓库管理
```

分层由 `eslint.config.js` 的 `no-restricted-imports` 与 `tests/unit/layering.test.mjs` 双重强制：

```
core ← 谁都不依赖        shared ← 零依赖（不许 node: / 第三方包）
modules ← core + shared   runtime ← 装配全部          web ← 只有 shared
```

**前端够不着 modules / runtime / core**——它消费后端的唯一方式就是 HTTP `/api`。
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐，
并检查面板里出现的每个 `/api` 路径都真实存在。

## 给 agent 用

```bash
nx-kv skill install               # 装到 ~/.claude/skills/nx-kv（本机任务总手册）
nx-kv skill install kv-get        # 领取侧：主动领取排给本目录的任务
nx-kv skill install kv-submit     # 提交侧：总结上下文、提炼需求，委托别的 agent
nx-kv skill install kv-repo       # 仓库 / 项目组 / 参考仓库管理
nx-kv skill list                  # 列出可装 skill、默认安装项与可装 group
nx-kv skill groups                # 列出 group → 包含哪些 skill
nx-kv skill install --group=<key> # 一键装整组（与 <name> 二选一）
nx-kv skill get [name] [ref]      # 输出 skill 全文，外部 agent 一键拿上下文
```

装好后 agent 就能按 skill 里的 SOP 领任务、读 instruction、完成后回填结果；
或在一个对话里靠 `localtask wait` 阻塞等待、连续接收用户任务，
把需求提炼成任务 `add` 到别的目录委托其它 agent。

## License

MIT
