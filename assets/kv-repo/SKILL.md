---
name: kv-repo
description: 识别并汇报本机仓库的相关分组（仓库组）——快捷入口 `/kv-repo <组名>`：一步到位加载该看板的成员仓库、领域描述与配合关系，输出关系报告。用 nx-kv repo / board 命令回答「这台机器上有哪些仓库、按领域怎么分组、组内谁是中心谁是终端、关键路径与搜索关键词在哪」。看板的领域描述（desc）+ 成员仓库的组内描述（note：它在组里的角色）共同构成写给 agent 读的上下文——领域侧重、仓库间配合关系（如 fr 组内 API 关联、go-ah 为 OIDC 中心其余为终端）、入口路径、搜什么关键词。触发词：/kv-repo、kv-repo、仓库组、相关仓库、这个仓库属于哪个组、组里都有什么、它们什么关系、中心/终端、领域描述、关键路径、加载 fr 的看板、看板相关项目、board list、repo list。反例：登记/扫描/增删仓库与看板用 nx-kv 主 skill 的 repo-registry；git 状态与 diff 一律找 git 自己。
---

# kv-repo — 仓库组识别与关系报告

回答两类问题：**「这组仓库是什么、怎么配合」**（给人看的关系报告）和
**「我现在这个任务该去哪些仓库找上下文」**（给 agent 自己用的定位）。
数据都在 nx-kv 的仓库模块里，两条命令足够。

## 快捷 SOP：`/kv-repo <组名|仓库名|路径>`

**带参数就是一步到位，不要反问、不要展开流程**：定位组 → 拉成员与领域描述 → 直接输出该组的关系报告。

```bash
nx-kv board list --json
# → { boards:[{ id, name, desc, repos:[{ id, name, desc, path }] }], unassigned:[…] }
```

- 参数是**组名**（如 `/kv-repo fr`）→ 在 `boards[]` 里按 name 找到它（找不到再试包含匹配），取该组输出报告；
- 参数是**仓库名或路径**（如 `/kv-repo go-ah`、`/kv-repo D:\code\a_go\proj\go-ah`）→ `nx-kv repo list --json` 定位仓库，报告它 `boards[]` 里的**每个**组（一个仓库可同时归入多个组）；
- 本地任务的上下文若已带 repo/boards，直接用，不必重查。

报告形状（desc 里的关键路径与关键词**原样带上**——它们是前人留下的搜索入口）：

```
【fr】Flutter 客户端组 —— 组内共享 API 契约
  fr      D:\code\a_dart\prj\fr      （组内）API 契约方：lib/api/ 是唯一入口，搜 fr_ 前缀
  …
（领域描述）<组的 desc 全文>
```

每行优先读**组内描述（note）**——它讲这个仓库在本组里的角色；没写 note 再回退仓库自己的 desc。
组领域描述（desc）与各仓库的关键路径 / 关键词**原样带上**——它们是前人留下的搜索入口。

**无参数**（`/kv-repo`）：输出全部组速览——每行「组名 · 成员数 · desc 首行」+ 未分组计数，
然后问用户要深入哪一组（只问这一次，别连环追问）。

## 模型（30 秒版）

- **仓库登记** = 本机事实（name / path / desc / notes / type / remote），一张中心清单。
  `type` 区分开发仓库（dev，默认）与参考仓库（ref，远程 clone 下来的、统一放 gitRepoRoot）。
- **看板** = 领域分组；一个仓库可同时归入多个组，分组只此一条路（没有标签）。
- **看板的领域描述（desc）+ 成员的组内描述（note）是写给你（agent）读的上下文**：
  desc 讲这个领域的侧重与配合方式；note 讲单个仓库在组里的角色（谁是中心 / 终端、
  API 关联在哪、关键路径、搜什么关键词）。**接到任务先读它们，比翻代码快。**
- **参考仓库的 linked 是第三维上下文**：绑定是多对多（一个参考服务多个仓库/组，一个仓库
  挂多个参考），`note` 写在**关系上**——同一条参考在不同组里的意义可以不同。接到任务时
  `repo ref of <本仓库>` 一条命令拿全两层：自己的参考 + 所在组的命名空间参考。

## 完整命令（速查）

```bash
nx-kv board list --json          # 首选：全部组 + 成员（含组内描述 note）+ 各组领域描述
# → { boards:[{ id, name, desc, repos:[{ id, name, desc, path, note }] }], unassigned:[…] }
nx-kv repo list --json           # 扁平清单，每条带 boards[]（查单个仓库的归属）
nx-kv repo ref of <id|路径> --json    # 这个仓库的参考：第一层直接绑定，第二层按看板命名空间
nx-kv repo get <id|绝对路径> --json   # 单仓库详情 + 所在组
nx-kv board get <id> --json          # 单组详情（成员 + 组内描述）
nx-kv board note <id|绝对路径> --board <看板id> --note "角色/配合关系/关键路径/关键词"
                                     # 写或清（--note 留空 = 清除）组内描述
nx-kv repo ref check                 # 参考仓库完整性：目录/origin 一致性 + 绑定死链
```

定位顺序：拿到任务/目录 → `repo list` 按**路径或目录名**找到仓库
→ 它的 `boards[]` 给出所属组 → 回 `board list` 读该组的 `desc` 与**兄弟仓库**。

## 维护：发现过期就修（这是本 skill 的另一半职责）

读到的 desc 与代码现实不符（路径变了、关系变了、压根没写）时，顺手补上：

```bash
nx-kv board update <id> --desc "侧重…；谁配合谁（谁是中心/终端、API 关联在哪）；关键路径…；搜索关键词…"
nx-kv board note <仓库id|路径> --board <看板id> --note "这个仓库在组里的角色…；关键路径…；搜什么"
```

写领域描述的约定（一个看板一个领域，侧重各不相同）：

1. **一句话侧重**：这组仓库共同在做什么；
2. **配合关系**：谁是中心、谁是终端、谁调谁的 API（如 fr 组内 API 关联、go-ah 与其接入方）——组级关系写看板 desc，单个仓库的角色写 board note；
3. **关键路径**：契约文件 / 配置 / 入口代码的位置（如 `lib/api/`、`issuer 192.0.2.47:8082`）；
4. **搜索关键词**：下次 agent 该搜什么（如 `fr_` 前缀、模块名）。

## 边界

- 本 skill **只读分组与描述**；登记/扫描/增删仓库看板走 nx-kv 主 skill（repo-registry）。
- 不碰 git：状态 / diff / pull / push 一律直接用 git 自己。
- 数据按 groupId 隔离，查询前先确认工作空间对不对（`nx-kv group current`）。
