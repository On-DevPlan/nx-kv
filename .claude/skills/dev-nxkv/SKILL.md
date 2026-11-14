---
name: "dev-nxkv"
description: "nx-kv 仓库开发指引（按层路由）：A 数据结构与关系 / B 架构与 action 注册 / C serve 端 / D web 端 / E 交付流程。改 nx-kv 代码、加 action/CLI/面板/表、改提示词渲染或依赖判定时使用；仅使用 nx-kv 领任务/提交任务时不要用。"
---

# nx-kv 开发指引（路由表）

本文件**只做路由**。所有实现在 `references/`，按「层」分序列。先用下面的序列总览定位到层，再用 ref-map 找到具体文件。

## 什么时候触发

- 修改 `nx-kv` 仓库源码：新增 / 修改 action、CLI、HTTP、面板、数据库表、设置项、提示词渲染、依赖 / 闸门。
- 需要判断改动该落在 `core` / `shared` / `modules/<id>` / `runtime` / `web/frontend` 哪一层。
- 需要交付验收证据（lint、typecheck、单测、smoke、build、真实渲染输出）。
- **不适用**：只是用 `nx-kv` 领取 / 提交任务、查询清单、安装该 CLI 的用户侧操作（看 `README.md` 与 `docs/`）。

## 序列总览（先读这里）

| 代号 | 类别 | 回答什么问题 | 成员 |
|---|---|---|---|
| **A** | 底层数据结构 | 数据存在哪张表、是什么、彼此怎么连、键位在哪 | A01 表与字段 / A02 关系模型 / A03 键与扩展位 |
| **B** | 架构与 action | 代码分几层、入口在哪、action 怎么声明与注册、领域子系统怎么运转 | B01 分层与目录 / B02 action 全表 / B03 action 契约 / B04 提示词渲染链 / B05 依赖与工作流引擎 |
| **C** | serve 端 | 面板后端怎么起、请求怎么进来、跨域与端口冲突怎么办 | C01 serve 端 |
| **D** | web 端 | 前端有哪些组件、页面怎么组、对应哪个 API | D01 组件结构 / D02 页面与组件关系 |
| **E** | 交付 | 一个功能点怎么从需求走到验收，证据怎么给 | E01 功能点 SOP / E02 验证与证据 / E03 坑库 |

## 不可省略的硬约束（跨层，任何改动都适用）

1. **全仓 TS**：源码只有 `.ts` / `.tsx`（唯一的 `.js` 是 `src/index.js` —— 面向包外消费方的 tsx 垫片）。**import 路径保留 `.js` / `.jsx` 后缀**，由 tsx loader / vite 解析到同名 `.ts` / `.tsx`——写 import 时不要「顺手改成 .ts」。
2. 功能入口只走模板形态 action：`src/modules/<id>/actions/<名>.ts`，**一条 action 一个文件**——`@action` 装饰器 + `ActionBase<typeof input>` 泛型基类 + **zod 契约内联在该文件**（名为 `input`，方法名固定 `run`）；清单由 `pnpm gen`（gen:actions）扫目录收进 `actions/_manifest.generated.ts`，**模块 index.ts 不手工列举 action**。`http` 可显式为 `null`，**每条 action 必须有 `cli`**。legacy flags 表契约只剩 runtime 内建命令（serve / help / version）在用，业务模块不扩张。
3. 模块间只通过对方 `service.ts` / 导出面协作；禁止 import 别的模块内部实现，也禁止 import runtime 的**装配层**（cli / registry / server / api / spec / help / codegen）——模板的公共契约层（types/module、action-base、action-decorator、container）例外。模块互依禁列是**枚举式**的，新增模块要手动补 `eslint.config.js`。
4. 跨模块、无副作用的纯函数才放 `src/shared/`；`src/core/` 只放原语（db、错误、模板引擎等），不放业务。
5. SQLite 是唯一业务数据源。schema 只加新 migration：`src/core/db/migrations/vN+1.sql`（已发布快照**不可变**）+ `migrations/index.ts` 登记边 + **`@decision docs/decisions/<文件>.md` 决策注释**（`check-schema-decisions` 门禁强制）；**禁止改已发布版本文件**。
6. 提示词只走「一份共享 ctx + Handlebars 模板字符串 + 薄编排」。禁止自研解析器、区块对象、每块独立变量域、服务端预拼列表文本。
7. 测试必须用临时库 / 临时目录（`tests/support/test-store.mjs`）；禁止写用户真实库。真实库操作前先 `nx-kv db backup`。
8. 前端页面组件**不许裸调 `api()`**：页面私有调用收口到本页 `page/<name>/api.ts`（模板约定，eslint 强制，`api.ts` 自身豁免）。
9. 单文件行数门禁：≤500 干净；601–1000 必须登记 `scripts/line-lint-registry.json`（只许降不许升）；>1000 禁止。
10. 改 CLI、面板、内置技能行为时，同步 `README.md`、`docs/`、`assets/` 与 `.claude/skills/`，不要只改一处。改了 action 声明要跑 `pnpm gen`，并**重启 serve** 才生效。

## ref-map（按需加载）

### A · 底层数据结构

| 场景 | 代号 | 文件 | 何时读 |
|---|---|---|---|
| 表有哪些、每列是什么、身份与软删语义 | A01 | [A01-数据模型.md](references/A01-数据模型.md) | 动 schema / 写 SQL / 拿不准某列含义时 |
| 谁连谁、这条边是什么语义、约束与陷阱 | A02 | [A02-关系模型.md](references/A02-关系模型.md) | 加外键 / 加关系表 / 依赖与附件挂错时 |
| 这个值该落到哪个键位、谁是权威、哪些键已废弃 | A03 | [A03-键与扩展位.md](references/A03-键与扩展位.md) | 加设置项 / 读 `ext` / 迁移旧键时 |

### B · 架构与 action

| 场景 | 代号 | 文件 | 何时读 |
|---|---|---|---|
| 代码分几层、依赖方向、模块骨架、新增模块步骤 | B01 | [B01-架构分层.md](references/B01-架构分层.md) | 决定改哪一层、新建模块或目录时 |
| 这个功能现在走哪条命令 / 哪个路由；全量入口清单 | B02 | [B02-action注册全表.md](references/B02-action注册全表.md) | 找现有入口、核对命令与路由、登记新入口时 |
| action 的 zod 契约、CLI/HTTP 一致性、CRUD 与注册自检 | B03 | [B03-action契约.md](references/B03-action契约.md) | 新增 / 修改 action、动参数校验时 |
| 交付提示词怎么拼出来；改模板要动哪 | B04 | [B04-提示词渲染链.md](references/B04-提示词渲染链.md) | 动提示词、模板、交付上下文、设置页时 |
| 依赖、闸门、DAG、工作流引擎与编排面板 | B05 | [B05-依赖与工作流引擎.md](references/B05-依赖与工作流引擎.md) | 动依赖 / 顺序 / 工作流 / 编排面板时 |

### C · serve 端

| 场景 | 代号 | 文件 | 何时读 |
|---|---|---|---|
| 进程、请求分派、路由编译、CORS、端口协商、SSE | C01 | [C01-serve端.md](references/C01-serve端.md) | 动 HTTP 接口 / serve 启动 / 跨域 / 端口 / 事件流时 |

### D · web 端

| 场景 | 代号 | 文件 | 何时读 |
|---|---|---|---|
| 前端组件树与各自职责、布局与面板模型、样式约定 | D01 | [D01-组件结构.md](references/D01-组件结构.md) | 改 UI、找组件落点、理清前端骨架时 |
| 页面 ↔ 组件 ↔ API 的对应关系与改动的落点 | D02 | [D02-页面与组件关系.md](references/D02-页面与组件关系.md) | 改某个页面 / 接线某个接口 / 排查「按钮点了没反应」时 |

### E · 交付

| 场景 | 代号 | 文件 | 何时读 |
|---|---|---|---|
| 一个功能点从需求到验收的标准动作清单 | E01 | [E01-功能点SOP.md](references/E01-功能点SOP.md) | 接到功能需求后照着做 |
| 固定检查项、两层渲染校验、测试隔离、DB 验证、汇报格式 | E02 | [E02-验证与证据.md](references/E02-验证与证据.md) | 编码完成、准备汇报前 |
| 本项目已踩过的坑与反模式（症状 → 根因 → 做法） | E03 | [E03-坑库.md](references/E03-坑库.md) | 设计评审与提交前自检 |

## 典型起手路径

| 你要做的事 | 读 |
|---|---|
| 加一张表 / 改字段 | A01 → A02 → A03 → E01 |
| 加一条命令或接口 | B01 → B02 → B03 → E01 → D02（若要面板） |
| 改交付提示词 | B04 → A03 → E02 |
| 改依赖 / 闸门 / 编排 | A02 → B05 → D02 |
| 改 HTTP 接口行为 | B03 → C01 → D02 → E02 |
| 改面板某个页面 | D01 → D02 → B03（对应 action）→ E02 |
| 只想快速定位一段逻辑 | B02（全表）→ 对应层的 ref |

## 仓库事实入口（需要核对时先看这些）

- 命令与路由：`node bin/kv.mjs routes --module <id>`、`node bin/kv.mjs help --json`（二者同源同长；2026-11-14 校准为 129 条 = 126 action + 3 平台命令，**数字以命令输出为准**）
- 表结构：`src/core/db/migrations/`（`v4.sql` 是最新跃迁；`v1.sql` 是初始快照，永不修改）；决策注释门禁见 `scripts/check-schema-decisions.mjs`
- 决策依据：`docs/decisions/`（含 `versions/` 下逐版说明）
- 使用者文档与变更记录：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`
- 术语规范：`docs/glossary.md`
- 类型与门禁：`tsconfig.base/node/web.json`（strict 三配置）、`eslint.config.js`（分层约束）、`scripts/check-lines.mjs`（行数门禁）

> 本 skill 记的是**快照**，代码是唯一真相。发现两者不一致时以代码为准，并顺手修本 skill。
