# 项目组 / 项目 · 任务流水线 CLI

> 目的：把「项目组（看板）/ 项目（仓库登记）」两级上下文接进 nx-kv 的**本地任务流水线**——
> `timegoal（时间目标）→ waitgoal（持续 get）→ 提交任务 → 领取 → 完成回填 → 修改反馈重开`。
>
> 本文所有命令都是 `nx-kv` 的真实 CLI（v0.14.0，沙箱实测通过），不是伪代码。
> 全量参数查：`nx-kv help localtask` / `nx-kv help tasktool` / `nx-kv help repos` / `nx-kv help docs`。
> 机器可读输出：任意命令加 `--json`。

---

## 0 · 名词与落点（先对齐三件事）

| 概念 | CLI 实体 | 寻址方式 | 对任务的作用 |
|---|---|---|---|
| 项目组 | `board`（看板） | `board id` / `board key` / **组名**（三者都认） | 标 frontmatter（归属必须落在某个项目上） |
| 项目 | `repo`（仓库登记） | repo `key` / 名称 / **绝对路径**（三者都认） | **决定落点目录** = 仓库路径 = 队列主题 |
| 任务 | `localtask` | `--cwd`（主题） / `--key` | 队列 = 工作目录；`get` 必须在同一个 cwd |

**队列即目录**：任务落在哪个目录的队列，就只能在那个目录 `get`。所以：

- `--project` 决定落点（落点 = 该项目的仓库路径）；给了 `--project` 就不用再给 `--cwd`；
- `--cwd` **只在显式给了**时才参与校验（须与 `--project` 指向同一个项目，否则报错）——
  它**不参与归属推断**（归属只能是项目）；
- `--board` **必须配 `--project`**：组内任务的归属不能不明。只给 `--board` 会直接报错
  （「要指明归属项目」+ 列出本组成员）。

---

## 1 · 准备（一次性）：让组 / 项目有「介绍」可带

介绍不是凭空来的：它来自**仓库登记的 desc / 看板 desc / 组内 note**，落盘成自有 md 树，
再被任务与交付引用。

```bash
# 1.1 登记项目（desc = 一句话介绍，会被播种成「项目介绍」正文）
nx-kv repo add D:\DevProjects\my\github\nx-kv --name nx-kv \
  --desc "KV 清单管理中枢：远程清单 + 本机任务队列"

# 1.2 建项目组
nx-kv board add nx --desc "nx 系列工具：共用 CLI / 面板 / skill 体系"

# 1.3 把项目挂进组（仓库给 key / 名称 / 路径都行；一个项目可挂多个组）
nx-kv board assign nx-kv --board nx

# 1.4 写「组内描述」：这个项目在组里占什么位置（可多行）
nx-kv board note nx-kv --board nx --note "CLI / 面板 / skill 的宿主仓"

# 1.5 把 desc / note 播种成 md 文档（缺省预览，--apply 才落盘；幂等）
nx-kv docs seed --apply
```

播种产物（`~/.nx-kv/docs/`，`NX_KV_DOCS_DIR` 可改根）：

| 文件 | 内容 | 来源 |
|---|---|---|
| `repo/<key>.md` | **项目介绍** | `repo add --desc` |
| `board/<组 slug>.md` | **项目组介绍** | `board add --desc` |
| `group/<组 slug>/<key>.md` | 组内描述 | `board note --note` |

正文也可以手写或换成外部文件（外部只读、不进导出包）：

```bash
# 手写介绍正文（ref 必须带 .md；写完自动把摘要回写到 desc / 组内 note）
nx-kv docs set board/nx.md --body "# nx 系列
共享 CLI / 面板 / skill 体系。"
nx-kv docs set repo/local/nx-kv.md --body "# nx-kv
KV 清单管理中枢。"

# 把介绍指到外部文件（Obsidian vault 等）
nx-kv docs bind --board nx --path "D:\vault\nx\nx.md"
nx-kv docs bind --repo nx-kv --path "D:\vault\nx-kv.md"

# 给项目追加「其余介绍文档」（主篇之外；--tag 分类标签，简介行渲染成小 chip）
nx-kv repo doc add <repoId> --rel repo/local/nx-kv/reference/arch.md --note "架构说明" --tag 规范
nx-kv repo doc list <repoId>

# 给组追加「附加文档」（自有 rel / 外部绝对路径皆可；同 doc 重复添加 = 更新该条）
nx-kv docs link nx --doc board/nx/reference/qa.md --note "问答集" --tag qa
```

### 提示词 / 模板（设置面板「提示词 / 模板」一栏，CLI 同口径）

```bash
# 回调提示词（收尾指令）：多条，每条 ≤2000 字，最多 10 条
nx-kv localtask config --suffix "本轮最后再 wait 一次"
nx-kv localtask config --suffix-add "先读 docs 再动手"   # 按条增删：--suffix-remove <序号>

# ack 完成总结提示词：agent 写完成总结（ack）时的格式要求，随领取交付给到它
nx-kv localtask config --ack "完成总结按「改了什么 · 怎么验证 · 遗留什么」三段写"

# 任务模板槽位：正文里的 {{槽位名}} 处填这段文字（内置模板只改槽位，骨架不可改）
nx-kv template update default --values '{"背景":"把简介文档支持 tag"}'
```

> 介绍**懒播种**：即使没跑 `docs seed`，读取时也会按 desc/note 现场补种。

---

## 2 · 项目组口径（`--board`）

### 2.1 提交任务

```bash
# 组 + 项目级任务（唯一合法的组口径：归属必须落到某个项目上）
nx-kv localtask add "# 重构本地任务队列
把取任务/派任务两条链路合并。" \
  --board nx \
  --project nx-kv \
  --duration 2h \
  --goal-prompt "先看 tasktool/get.js 再动手" \
  --summary "发布时的现状"
```

```bash
# 只给组不给项目 → 直接报错，并列出本组成员
nx-kv localtask add "组级任务" --board nx
# 错误: --board「nx」的任务要指明归属项目：加 --project <项目>（本组成员：nx-kv / nx-rp / …）
```

`--board` / `--project` 认 id / key / 名称；**`--project` 必须是该组成员**，否则直接报错
（`项目「X」不是项目组「Y」的成员`），不静默放行。
`--global` 与 `--board/--project` **互斥**（全局池没有组/项目归属）。

### 2.2 frontmatter（任务正文头部）

提交时正文头部会被自动加上（`src/modules/localtask/frontmatter.js`）：

```markdown
---
board: b_mw0cjlcm2idd6
boardIntro: board/nx.md
boardDesc: nx 系列工具：共用 CLI / 面板 / skill 体系
project: local/nx-kv
projectIntro: repo/local/nx-kv.md
projectDesc: KV 清单管理中枢：远程清单 + 本机任务队列
---
# 重构本地任务队列
把取任务/派任务两条链路合并。
```

| 字段 | 含义 | 取值 |
|---|---|---|
| `board` | 归属组 | 组 id |
| `boardIntro` | **项目组介绍**的文档路径 | 绑定优先，缺省约定路径 `board/<组 slug>.md` |
| `boardDesc` | 项目组的一句话摘要 | 组 desc |
| `project` | 归属项目 | 项目 key |
| `projectIntro` | **项目介绍**的文档路径 | 绑定优先，缺省约定路径 `repo/<key 分段>.md` |
| `projectDesc` | 项目的一句话摘要 | 项目 desc |

- 提交口径 → 携带：
  - **项目组口径**（`--board` + `--project`）→ `board` + `boardIntro` + `boardDesc` + `project` + `projectIntro` + `projectDesc`；
  - **项目口径**（只给 `--project`）→ `project` + `projectIntro` + `projectDesc`（不标组）。
- **引用式**：介绍给的是**路径**而不是正文——正文是 md 文件，路径即地址，
  agent 拿到就能读盘（`nx-kv docs get rel:<路径>`）。内联正文既撑爆 frontmatter，
  又会在介绍更新后留下过期副本。
- 自有路径相对 `~/.nx-kv/docs/`（`NX_KV_DOCS_DIR` 可改根）；绑定到外部文件时给绝对路径。
- 正文里已有的其它字段**原样保留**；`--board/--project` 的值**覆盖**正文里同名键
  （CLI 的显式意图是最新的决定）。
- **改文案不丢 frontmatter**：`localtask update --text` / `localtask reopen --text`
  换正文时保留原 frontmatter（新正文自带的键优先，旧值补缺）——
  归组信息丢了，任务就会从组 / 项目面板里掉出去。
- **改归属即搬家**：上述两条路径的 effective `project` 解析到哪个登记项目，
  任务就迁到哪个队列（归属决定落点，与派任务同一套判定；编排收在
  `src/modules/tasktool/update.js`）。约束：已领取的任务不能改归属（先 reopen）；
  带队列内依赖/闸门的任务搬运会断链，先解除再改；搬家后任务拿到新队列的 id，
  返回值带 `moved/movedFrom` 供调用方跟号；指向它的跨队列引用（`topicKey:id`）
  改写到新地址；`projectIntro/projectDesc` 随归属刷新。
- **面板里单独显示**：frontmatter 在 MD 工作台（实时预览 / 阅读）渲染成独立的
  **属性卡**（键值表），自成一块、不与首行内容合并；点击卡片就地编辑这段
  frontmatter（等宽小字），正文块不受影响。

### 2.3 派任务统一口径（CLI / HTTP / 面板同一条链路）

派任务的**落点判定只有一份实现**：`src/modules/tasktool/add.js` 的 `submitTask`
（与领取侧的 `get.js` / `wait.js` 并列——领 / 等 / 派三个动词同构：action 层一行委托，
编排住在 tasktool，队列本体只有 localtask/service.js 一处）。CLI、HTTP、面板提交、
远程清单导入全走这一条链路：

- **显式 `--board` / `--project`（严格口径）**：校验组成员资格与 `--cwd` 一致性，
  frontmatter 由服务端统一落字段，落点 = 项目登记路径；
- **正文自带 frontmatter（fail-open）**：面板草稿、CLI 手写、导入的 md 都认——
  服务端读正文补齐介绍引用，**落点跟到解析出的项目队列**（调用方显式给过
  `--cwd` 时不挪窝，只补字段）；解析不了（组没了 / 成员变了 / 项目未登记）
  就原样提交，不拦下任务。

面板「组面板 → 新增任务」的草稿（正文带 `board` + `project`）提交时：认得出组就
显式交 `board`/`project`（严格口径）；只认得出 `project` 就交 `project`（项目口径）；
页签落点一律跟随服务端返回的真实主题 key。

CLI 也能走 fail-open 这条：正文以 `---` 开头不会被当成 flag（`---` 不是合法 flag 名），
直接引号包住即可：

```bash
nx-kv localtask add "---
board: b_mw0cjlcm2idd6
project: local/nx-kv
---
# 手写 frontmatter 的任务"
# ↑ 不带 --cwd：落点跟到 frontmatter.project 的项目队列；
#   显式加 --cwd 则落点以 --cwd 为准（只补介绍引用，不挪窝）。
```

---

## 3 · 项目口径（`--project`）

```bash
nx-kv localtask add "# 给 localtask get 加 JSON 输出
面板和 CLI 都要能拿到结构化结果。" \
  --project nx-kv \
  --duration 90m \
  --goal-prompt "改动后补一条单测" \
  --summary "发布时的现状"
```

落点目录 = `nx-kv` 的仓库路径；frontmatter 带 `project` + `projectIntro` + `projectDesc`。
**不带 `--board`** 时 frontmatter 不标组（任务可以是纯项目级的）。

---

## 4 · timegoal（时间目标）

两种口径，**互不冲突**，可同时存在：

### 4.1 任务级（随任务发布，领取即计时）

```bash
nx-kv localtask add "..." --project nx-kv --duration 2h --goal-prompt "先看日志再改"
```

- `--duration`：`10800`（秒）/ `5h` / `90m` / `2d` / `5小时`（范围 1 分钟 ~ 365 天）；
- `--goal-prompt`：附加要求，会随 check 指令一起固化回显；
- **领取即计时**；未领取时可 `localtask update --duration/--goal-prompt/--clear-goal` 改/清；
- 已领取计时中**冻结**（要调先 `reopen`）；
- 任务级 goal 的 key：`task:<topicKey>:<taskId>`（领取交付里自带）。

### 4.2 目录级（本目录的整体预算）

```bash
nx-kv timegoal set --cwd "D:\DevProjects\my\github\nx-kv" --duration 2h \
  --prompt "规划计划，然后完成这个任务；计划的最后一个动作是再次调用 localtask wait 收尾本轮。"

nx-kv timegoal show   --cwd "<dir>"          # 只查，不算时间
nx-kv timegoal check  --cwd "<dir>" --summary "本轮现状" --progress "完成度/下一步"
nx-kv timegoal update --cwd "<dir>" --prompt "新提示词"   # 保起点，只换提示词
nx-kv timegoal clear  --cwd "<dir>"
nx-kv timegoal list                            # 所有有 timegoal 的目录（按截止升序）
nx-kv timegoal log   --cwd "<dir>"            # 历次 check 的现状 + 完成度
nx-kv timegoal prune                          # 清掉已到点/已归档的目标
```

任务级 goal 存在时，**任务级优先**，目录级只作兜底（见 `src/modules/tasktool/wait.js`）。

### 4.3 timegoal 与完成的门禁

```bash
nx-kv timegoal check --task task:<topicKey>:<taskId> --summary "..." --progress "..."
# → reached:true 才允许：
nx-kv localtask done --id <id> --summary "<完成总结>" --progress "<完成度/下一步>"
```

未到点时 `done` 返回 **blocked**（不是报错）：

```
[blocked] 任务 #1 暂不能标完成：时间未到（剩 29.5 分钟，截止 2026-11-03 15:39:11）
——时间未到，不能标记完成——请派出 sub agent 重新提出新的需求
```

---

## 5 · waitgoal（项目级「持续 get」）

```bash
# 开启持续 get：该项目 get 无任务时自动唤起阻塞窗口等人回填
nx-kv repo update nx-kv --get-loop on --get-loop-minutes 10

# 自定义「继续 get」指令（整体替换这一条；多条在设置面板按条增删）
nx-kv repo update nx-kv --get-loop-template "完成上面的任务后，继续调用 nx-kv localtask get --summary \"<现状>\" 领下一条，直到 get 返回 timeout。"

# 关闭
nx-kv repo update nx-kv --get-loop off
```

- `--get-loop`：`on|off`；`--get-loop-minutes`：阻塞窗口分钟数（默认 10）；
  **实际阻塞上限是 600 秒（10 分钟）**（`localtask` 的 `MAX_TIMEOUT_SEC` 夹制）——
  填大于 10 的分钟数不会延长窗口；
- `--get-loop-template` 支持 `{{task.id}}` / `{{task.text}}` 等占位符；
- 落点：仓库登记的 `getLoop` 字段（`~/.nx-kv/repos.json`）；
- 效果：**没任务不再立即空手而回**，而是唤起阻塞窗口（开页面 + 等人回填）；
  领到任务时交付文本额外带「继续 get 直到超时」的项目模板。

---

## 6 · 领取 / 完成 / 回填 / 修改反馈

```bash
# 领取（默认直接领：队列有任务立即取走，没任务立即返回 timeout）
nx-kv localtask get --cwd "D:\DevProjects\my\github\nx-kv" --summary "我在这儿待命"

# 阻塞等待（agent 本轮最后一步：等人接力，唯一合法出口是 timeout）
nx-kv localtask wait --cwd "D:\DevProjects\my\github\nx-kv" --summary "现状"

# 完成回填
nx-kv localtask done --id 3 --summary "完成总结" --progress "完成度/下一步"

# 修改反馈 → 重开（任务回 pending，领取时间作废，可再次领取）
nx-kv localtask reopen --id 3 --text "# 标题
改过的正文"

# 查看 / 编辑 / 删除
nx-kv localtask show   --id 3 --cwd "<dir>"
nx-kv localtask update --id 3 --text "..." --duration 3h
nx-kv localtask remove --id 3            # 软删除（可 restore）
nx-kv localtask list                    # 主题总览

# 附件（嵌入即附件：正文里的 ![名](fileId) / [名](fileId)，面板编辑器同一条语法）
nx-kv localtask attach --id 3 --path "D:\doc\需求.docx"          # 落本机附件仓并嵌入（不碰云端）
nx-kv localtask attach --id 3 --fileId <32位hex> --name "需求"   # 引用已有附件（本机仓 / 云端）
nx-kv localtask attachments --id 3                       # 附件清单 + 本地是否已有
```

**附件链路口径**（2026-11-04 任务 #15 验收反馈定稿：**本地任务贴图走本地存储，
与云端零关联**）：

- **写侧**：`localtask attach --path` 与面板编辑器贴图/选文件都落**本机附件仓**
  （`~/.nx-kv/attachments/local/`，`core/localatt.js`——不发网、上传即落盘），
  以 markdown 嵌入追加到正文——正文即载体，附件跟着任务走；`file upload --local`
  是同一存储的直入口。`--fileId` 仍可引用已有附件（本机仓 id / 云端 id 都认）。
  面板侧（已落库任务）**贴图即同步**：嵌入写进正文后立刻 `PATCH` 服务端，
  不必再点「保存并同步」；实时预览用块内光标坐标插入（禁止把块内偏移当全文
  偏移，否则会插进 frontmatter，保存时被剥掉留下孤儿文件）。
- **读侧**：`get` / `wait` / `show` 交付时解析正文引用，**先查本机附件仓**（命中
  直接给绝对路径，零网络），未命中的 id（云端清单附件引用）才按本机设置
  「读任务时自动下载附件」走云端镜像（与 `file sync` 同一台账）。载荷带
  `task.attachments`（id / kind / name / localPath / synced / storage），
  instruction 追加〔附件〕段告诉 agent 去哪读文件。
- **预览**：`/api/file/content/:fileId` 本机仓优先——本地任务的贴图面板直读
  本机文件（离线可预览），未命中再透传云端出图（云端清单附件行为不变）。
- **fail-open**：附件能不能拿到跟任务能不能交付是两件事——同步失败不阻断领取
  （如实记进 `attachmentsSync.failures`）；正文没有引用时载荷与改造前逐字节一致。
- **云端清单（todo）不受影响**：清单页贴图仍走云端图床（那边本来就是云端任务配
  云端附件）；两条链路只共享「正文嵌入语法」这一份实现（`modules/todo/attach.js`）。

**领取交付**实测形状（组内项目任务）：

```
已取得下一条任务（本目录队列 · 排队任务 · 主题「…\nx-kv」现状「我在这儿待命」）: #1
  ---
  board: b_mw0cjlcm2idd6
  boardIntro: board/nx.md
  boardDesc: nx 系列工具：共用 CLI / 面板 / skill 体系
  project: local/nx-kv
  projectIntro: repo/local/nx-kv.md
  projectDesc: KV 清单管理中枢：远程清单 + 本机任务队列
  ---
  # 修 bug
  正文内容
  ── 收尾指令 ──
  〔项目介绍 · nx-kv〕（…\docs\repo\local\nx-kv.md）：
  # nx-kv
  KV 清单管理中枢：远程清单 + 本机任务队列
  〔项目组上下文 · nx〕
  组定位：……
  组介绍（…\docs\board\nx.md）：
  # nx
  ……
  本项目在组里的位置：……
  组内成员：
    - nx-rp：（无组内描述）
  〔时间目标「…」〕……
  本任务带时间目标（领取即计时，持续 30 分钟）。
  - 每轮推进先执行：nx-kv timegoal check --task task:<topicKey>:<id> --summary "…" --progress "…"
  - 时间未到不得标记完成……
```

- `〔项目介绍 · X〕` **总在最前**——项目级任务（不在任何组里）也带这一段；
- 上下文只进 `instruction`，**任务正文保持库存原文**；
- 「继续 get 直到超时」那条**只在项目开了持续 get 时**才出现。

---

## 7 · 闭环检查

整条链路 **已闭环**。下面是逐环检查结果与实现落点。

### ✅ 闭环的环节

| 环节 | 命令 | 状态 |
|---|---|---|
| 项目 / 组登记 | `repo add` `board add` `board assign` `board note` | 通 |
| 介绍落盘 | `docs seed --apply` / `docs set` / `docs bind` | 通（缺约定路径时**懒播种**） |
| 项目级提交 | `localtask add --project K` | 通：frontmatter 带 `project` + `projectIntro` + `projectDesc`，落进该项目队列 |
| 组 + 项目级提交 | `localtask add --board B --project K` | 通：frontmatter 再加 `board` + `boardIntro` + `boardDesc` |
| 组级提交不给项目 | `localtask add --board B` | **报错**（归属必须明确，并列出本组成员） |
| `--cwd` 与 `--project` 不一致 | `localtask add --project K --cwd <别的项目>` | **报错**（不静默取一个） |
| 任务级 timegoal | `localtask add --duration --goal-prompt` | 通：领取即计时、check 指令回显 |
| 目录级 timegoal | `timegoal set/check/show/clear/list/log/prune` | 通 |
| 完成门禁 | `localtask done --summary` | 通：未到点 blocked |
| 修改反馈重开 | `localtask reopen --id --text` | 通：回 pending、可再领、**frontmatter 保住** |
| 交付带**项目**介绍 | `localtask get` | 通：`〔项目介绍 · X〕` + 正文 + 可读路径 |
| 交付带**组**上下文 | `localtask get` | 通：组定位 / 组介绍 / 本项目位置 / 兄弟成员 / 参考文件路径 |
| 任务附件（嵌入即附件） | `localtask attach` / `localtask attachments` | 通：CLI `--path` 落本机附件仓 / `--fileId` 引用已有附件，嵌入正文；`get`/`wait`/`show` 交付带附件清单 + 本地路径（本机仓优先，云端引用按设置自动下载） |
| waitgoal 开关 | `repo update --get-loop*` | 通：配置落库；**只在开启时**才投递「继续 get」模板 |

### 🔧 本轮修掉的断点

| 断点 | 症状 | 修法 | 落点 |
|---|---|---|---|
| **A. frontmatter 不带「介绍」** | 提交时只写 `board` id / `project` key，组介绍与项目介绍都没带 | frontmatter 增加 `boardIntro` / `boardDesc` / `projectIntro` / `projectDesc`（**引用式**：路径 + 一行摘要） | `src/modules/localtask/board-target.js` |
| **B. 组级任务没有落点** | 只给 `--board` 时任务落进提交者的当前目录，别的目录领不到 | 组口径**必须**带 `--project`（归属不明就报错）；`--cwd` 退化为纯校验，不参与归属推断 | `src/modules/localtask/board-target.js`、`src/modules/localtask/index.js` |
| **C. 「持续 get」模板无条件投递** | 没开持续 get 的项目，交付里也带「继续调用 localtask get 直到超时」，与 instant 语义自相矛盾 | 只在 `loop.enabled` 时叠加模板 | `src/modules/tasktool/get.js` |
| **D. 交付里没有「项目介绍」** | agent 知道组是干什么的，却不知道这个项目是干什么的 | 组上下文前补 `〔项目介绍 · X〕` 段；**不在任何组里的项目也带** | `src/modules/docs/knowledge.js`、`src/modules/tasktool/groupctx.js` |
| **E. 改文案抹掉 frontmatter** | `reopen --text` / `update --text` 整段替换正文 → 归组信息没了 → 任务从组面板掉出去 | 换正文时保留原 frontmatter（新正文自带的键优先，旧值补缺） | `src/modules/localtask/frontmatter.js`、`src/modules/localtask/service.js` |
| **F. 面板口径与 CLI 不同源** | ①面板草稿自带 `board`+`project` 提交，服务端不补介绍引用；②组面板建的任务在归属项目**还没有队列**时落进全局池；③提交后页签停在旧 scope，指向别的队列里的任务号；④落点判定三处实现（CLI action 内联 / 面板四路分支 / 远程导入绕过组语义），必然分叉 | 派任务编排收敛为一条链路：`tasktool/add.js` 的 `submitTask`（与领取侧 get/wait 同构，action 层一行委托）；显式 `board`/`project` 走严格口径，正文自带 frontmatter 走 fail-open——补介绍引用**且落点跟到项目队列**（显式给过 `--cwd` 时不挪窝）；面板只认归属不再自判队列，页签跟到服务端返回的真实主题 key | `src/modules/tasktool/add.js`、`src/modules/localtask/index.js`、`src/modules/localtask/service.js`、`src/web/frontend/page/dir/task.jsx` |
| **G. 正文以 `---` 开头被当 flag** | `localtask add "---…"` 报「未知参数 ---」——带 frontmatter 的正文根本提交不上去 | 只把「像 flag」的 token（`--` + 字母/数字）当 flag；`---` 与 `--` 分别是正文与「后面全是位置参数」 | `src/runtime/cli.js` |
| **H. 附件链路与 web 界面不对齐** | 面板编辑器已把附件嵌进正文（任务 #8），但 `get`/`wait` 交付不带附件清单、不自动下载、不标本地路径，CLI 也没法挂附件——agent 拿到 `![x](fileId)` 无从下手 | 口径与云端 todo 同构：新增 `localtask attach` / `localtask attachments`；交付侧 `annotateTaskDelivery` 解析正文引用 → 按设置自动下载 → `task.attachments` + instruction〔附件〕段；零引用时载荷逐字节不变 | `src/modules/tasktool/attach.js`、`src/modules/tasktool/wait.js`、`src/modules/localtask/index.js` |
| **I. 本地任务贴图被送上了云端（H 的验收反馈，任务 #15 重开）** | 面板编辑器贴图走 `POST /api/file` → **云端图床**；云端不可达/未登录时静默退回 localStorage dataURL——界面看着有图，正文里只有死引用甚至什么都没有，agent 领取时 `attachments count: 0`（用户案例：sedoc 组 #23「图片参考：如附件」实为空） | 口径改定：**本地任务贴图走本地存储，与云端零关联**——新增本机附件仓 `core/localatt.js`（`~/.nx-kv/attachments/local/`，台账同 attachstore 形状）；编辑器贴图改走 `file upload --local`（上传即落盘）；`file content` 路由本机仓优先（离线可预览）；领取标注先查本机仓（命中即绝对路径，全命中零网络），未命中的云端 id 才走镜像同步；`localtask attach --path` 同步改落本机仓 | `src/core/localatt.js`、`src/modules/file/{index,service}.js`、`src/modules/tasktool/attach.js`、`src/web/frontend/components/cloud/upload.js`、`src/web/frontend/components/md/attachments.js` |
| **J. 面板贴图上传成功但正文未嵌入（I 的验收反馈，任务 #15 再开）** | 实时预览把**块内**光标偏移当成全文 `insertAt` → 嵌入插进 frontmatter；保存时 `stripFrontmatter` 剥掉嵌入，仓里留下孤儿文件；FM 键被撕成残留（如 `d: b_…`）。同时贴图只改会话文档、不自动同步服务端 | `insertAttachmentSnippet`：live 用块坐标、edit 用全文偏移，落点禁止进 FM；已落库任务贴图后立刻 PATCH 同步；`md-blocks` 单测锁住「插进 FM 内 → 改插到 FM 后」 | `src/web/frontend/modules/md/md-parse.js`、`src/web/frontend/components/md/md-panes.jsx`、`src/web/frontend/page/dir/task.jsx`、`tests/unit/md-blocks.test.mjs` |

> 回归测试：`tests/unit/localtask-submit.test.mjs`（派任务统一链路：fail-open 落点跟到项目队列 / 显式 cwd 不挪窝 / 认不出归属不拦任务 / 严格口径不变 / action 委托）、
> `tests/unit/localtask-group.test.mjs`（frontmatter / 介绍引用 / 保留 / 面板口径）、
> `tests/unit/group-context.test.mjs`（交付带项目介绍）、
> `tests/unit/localtask-attach.test.mjs`（附件链路：零引用载荷不变 / 标注与〔附件〕段 / 台账命中给绝对路径 / 本机仓命中零网络标注 / `--path` 落本机附件仓 / attach 参数校验 / claim 交付带附件）、
> `tests/unit/localatt.test.mjs`（本机附件仓：落盘台账 / id 与云端同构 / 重名去重 / 补扩展名 / `file upload --local` / `file get` 本机仓优先）、
> `tests/unit/md-blocks.test.mjs`（附件嵌入落点：edit 偏移落 FM 内改插到后 / live 块内 caret 不碰 FM / 焦点在 FM 上改插到下一块）、
> `tests/unit/taskgoal.test.mjs`（未开持续 get 不带循环指令 / 改文案不丢 frontmatter）、
> `tests/unit/cli-args.test.mjs`（`---` 开头正文 / `--` 位置参数）。

---

## 8 · 速查：两条完整流水线

### 8.1 项目组口径

```bash
# ── 准备（一次性）────────────────────────────────────────
nx-kv board add nx --desc "nx 系列工具"
nx-kv repo add D:\DevProjects\my\github\nx-kv --name nx-kv --desc "KV 清单管理中枢"
nx-kv board assign nx-kv --board nx
nx-kv board note nx-kv --board nx --note "CLI / 面板宿主仓"
nx-kv docs seed --apply

# ── waitgoal（项目级持续 get）───────────────────────────
nx-kv repo update nx-kv --get-loop on --get-loop-minutes 10

# ── timegoal（目录级）──────────────────────────────────
nx-kv timegoal set --cwd "D:\DevProjects\my\github\nx-kv" --duration 2h \
  --prompt "规划计划后完成任务；最后一动作是再次 localtask wait 收尾本轮。"

# ── 提交任务（组 + 项目级，带任务级 timegoal）──────────
nx-kv localtask add "# 任务标题
正文" \
  --board nx --project nx-kv \
  --duration 2h --goal-prompt "附加要求" \
  --summary "发布时的现状"

# ── 领取 → 推进 → 完成 ─────────────────────────────────
nx-kv localtask get --cwd "D:\DevProjects\my\github\nx-kv" --summary "现状"
nx-kv timegoal check --task task:<topicKey>:<id> --summary "本轮现状" --progress "下一步"
nx-kv localtask done --id <id> --summary "完成总结" --progress "完成度/下一步"

# ── 修改反馈 → 重开 → 再领 ─────────────────────────────
nx-kv localtask reopen --id <id> --text "# 任务标题
改过的正文"
nx-kv localtask get --cwd "D:\DevProjects\my\github\nx-kv" --summary "继续"
```

### 8.2 项目口径

```bash
# ── 准备 ────────────────────────────────────────────────
nx-kv repo add D:\DevProjects\my\github\nx-kv --name nx-kv --desc "KV 清单管理中枢"
nx-kv docs seed --apply

# ── waitgoal ───────────────────────────────────────────
nx-kv repo update nx-kv --get-loop on --get-loop-minutes 10

# ── 提交（项目级；不带 --board 则 frontmatter 不标组）──
nx-kv localtask add "# 任务标题
正文" \
  --project nx-kv \
  --duration 90m --goal-prompt "附加要求" \
  --summary "发布时的现状"

# ── 领取 → 推进 → 完成 ─────────────────────────────────
nx-kv localtask get --cwd "D:\DevProjects\my\github\nx-kv" --summary "现状"
nx-kv timegoal check --task task:<topicKey>:<id> --summary "本轮现状" --progress "下一步"
nx-kv localtask done --id <id> --summary "完成总结"

# ── 需要全量上下文时（项目介绍 + 组介绍 + 组内描述 + 参考仓库）──
nx-kv repo knowledge --md
```
