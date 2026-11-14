---
name: "dev-nxkv"
description: "nx-kv 仓库的按层动作手册。A 表结构（迁移/表/列/设置键/查库）、B server（action/service/提示词/工作流/assets）、C 前端（页面/面板/组件/样式）、D 跨层（定位/交付/排障）。触发词：改 nx-kv、加一条命令、加 action、加接口、加 CLI、加表、加字段、加迁移、加设置项、改业务逻辑、改 service、改事务、改提示词、改模板、改依赖、改编排、加面板、加页面、改前端、改交互、改样式、跑测试、交付验证、报错排查、找不到代码、查数据库、dev-nxkv。仅用 nx-kv 领任务/提交任务时不要用本 skill。"
---

# dev-nxkv — 按层分的 SOP 集

本文件**只做路由**。每条 SOP 都是可执行的动作序列，没有「供阅读的背景知识」。

## 第 0 步：判层（一次判定，别跳）

| 改动落在 | 序列 | 典型信号 |
|---|---|---|
| 库表/列/索引/约束/迁移/设置键 | **A · 表结构** | 要存一个新东西、要按它查 |
| action/service/repo/runtime/提示词/工作流/`assets/` | **B · server** | 要一个入口、改判定、改交付文本 |
| 页面/面板/组件/样式/交互 | **C · 前端** | 要一个界面、点了没反应 |
| 定位、交付、故障 | **D · 跨层** | 只有现象没有位置 |

A/B/C 是三层；跨层改动按 **A → B → C** 的顺序做（先定数据形状，再定接口，最后接界面）。D 不参与分层，任何时候都能用。

## 场景表

### A · 表结构（数据层）

| 你要做的事 | SOP |
|---|---|
| 加表、加列、加索引、改约束、加设置键、写迁移 | `A01-加表或字段.md` |
| 查库里的真实数据、修本机数据、备份与恢复 | `A02-查库与改数据.md` |

### B · server

| 你要做的事 | SOP |
|---|---|
| 加/改一条命令或 HTTP 接口（action 声明） | `B01-加一条命令.md` |
| 改已有业务规则、事务边界、错误语义、派生字段 | `B02-改业务逻辑.md` |
| 改交付提示词、区块模板、渲染链 | `B03-改提示词渲染.md` |
| 改任务依赖、闸门、工作流编排 | `B04-改依赖与编排.md` |
| 改内置技能（`assets/`）、README/docs、CHANGELOG | `B05-改内置技能.md` |

### C · 前端

| 你要做的事 | SOP |
|---|---|
| 加面板页面、登记路由与面板、接新接口 | `C01-加面板页面.md` |
| 改既有页面的交互、共享组件、样式、快捷键 | `C02-改交互与组件.md` |

### D · 跨层

| 你要做的事 | SOP |
|---|---|
| 不知道改哪个文件、这块逻辑在哪 | `D01-定位代码.md` |
| 提交前跑门禁、准备验收证据、推送 | `D02-交付验证.md` |
| 报错、白屏、接口 404、端口冲突、测试翻车 | `D03-排障.md` |

## 五条全局门禁（每条 SOP 收尾都过）

1. **全仓 TS**：源码只有 `.ts` / `.tsx`；import 路径**保留 `.js` / `.jsx` 后缀**，loader 解析到同名 TS 文件。
2. **一条 action 一个文件**：`src/modules/<id>/actions/<cli首词>-<动词>.ts`，`@action` + zod 契约内联 + 方法名 `run`；`cli` 必须有，`http` 可为 `null`。改完 `pnpm gen`，并**重启 serve**。
3. **schema 只加不改**：新迁移 `vN+1.sql`（已发布快照不可变）+ `DIRECT_EDGES` 登记边 + 每张 `CREATE/DROP TABLE` 前一行 `-- @decision docs/decisions/<文件>.md` 且该文件真实存在。
4. **前端只走 HTTP**：禁止 import `modules/` `runtime/` `core/`，只能用 `src/shared/`；页面不裸调 `api()`，收口到 `page/<name>/api.ts`。
5. **测试不碰真实库**：一律 `tests/support/test-store.mjs` 的临时库；动真实库前先 `node bin/kv.mjs db backup`。

## 事实现查（不要记数字、不要信旧文档）

```powershell
node bin/kv.mjs routes                      # 全部命令 ↔ 路由（条数以输出为准）
node bin/kv.mjs routes --module <id>        # 某模块有哪些入口
node bin/kv.mjs help --json                 # 可解析的命令表
grep -n CURRENT_SCHEMA_VERSION src/core/db/version.ts   # schema 版本
ls src/core/db/migrations/*.sql             # 迁移到尾号
ls src/modules/                             # 现存模块（历史模块会被删）
pnpm run                                     # 全部脚本（lint/typecheck/build/test…）
```

## 序列约定（`pnpm lint` 强制）

- 文件名固定 `<序列><两位序号>-<动作>.md`，序列只能是 `A`（表结构）/ `B`（server）/ `C`（前端）/ `D`（跨层）。
- 新增 SOP 必须挂到某个序列下并被本文件路由；**A/B/C 每个序列至少一条**，否则门禁失败。
- SOP 里的路径与 `node bin/kv.mjs <cmd>` 都会被逐条核对——写错路径、写不存在的命令，lint 直接拦。

> 本 skill 记的是**动作**，代码是唯一真相。步骤里的路径不存在时，先跑 `D01-定位代码` 重新定位，再回来修这条 SOP。
