---
name: "dev-nxkv"
description: "nx-kv 仓库的**动作手册**：改代码前先按场景表打开对应的 SOP，照步骤跑命令、改文件、过门禁。覆盖加命令（action）、加表/字段/设置键、加面板页面、改提示词模板、改依赖与编排、改内置技能、交付验证、排障、定位代码、查库改数据。触发词：改 nx-kv、加一条命令、加 action、加接口、加 CLI、加表、加字段、加迁移、加设置项、加面板、加页面、改前端、改提示词、改模板、改依赖、改编排、跑测试、交付验证、报错排查、找不到代码、查数据库、dev-nxkv。仅用 nx-kv 领任务/提交任务时不要用本 skill。"
---

# dev-nxkv — 改 nx-kv 的 SOP 集

本文件**只做路由**。每一条都是可执行的动作序列，没有「供阅读的背景知识」。

## 怎么用（三条）

1. 用下面的场景表定一条 SOP，打开它。
2. SOP 的 **① 前置** 里的命令**先跑**——用输出当事实，不要凭记忆、不要凭本文件。
3. 只做 SOP 列出的步骤；遇到 SOP 没写的异常，去 `T08-排障` 补一条再继续。

## 场景表

| 你要做的事 | SOP |
|---|---|
| 加/改一条命令或 HTTP 接口 | `T01-加一条命令.md` |
| 加表、加字段、加设置键、写迁移 | `T02-加表或字段.md` |
| 加面板页面、改前端交互、接线接口 | `T03-加面板页面.md` |
| 改交付提示词、模板、渲染链 | `T04-改提示词模板.md` |
| 改任务依赖、闸门、工作流编排 | `T05-改依赖与编排.md` |
| 改内置技能（`assets/`）或用户文档 | `T06-改内置技能.md` |
| 提交前跑门禁、准备验收证据 | `T07-交付验证.md` |
| 报错、白屏、接口 404、端口冲突、测试翻车 | `T08-排障.md` |
| 不知道改哪个文件、这块逻辑在哪 | `T09-定位代码.md` |
| 查库里的真实数据、修本机数据、备份迁移 | `T10-查库与改数据.md` |

## 五条全局门禁（每次交付都过，任何 SOP 都适用）

1. **全仓 TS**：源码只有 `.ts` / `.tsx`；import 路径**保留 `.js` / `.jsx` 后缀**，loader 解析到同名 TS 文件。写 import 时不要「顺手改成 .ts」。
2. **一条 action 一个文件**：`src/modules/<id>/actions/<cli首词>-<动词>.ts`，`@action` 装饰器 + zod 契约内联（常量名 `input`）+ 方法名 `run`。`http` 可为 `null`，**`cli` 必须有**。改完必须 `pnpm gen`，并**重启 serve**。
3. **schema 只加不改**：新迁移 `src/core/db/migrations/vN+1.sql`（已发布快照不可变）+ `migrations/index.ts` 的 `DIRECT_EDGES` 登记边 + **每张 CREATE/DROP TABLE 前一行 `-- @decision docs/decisions/<文件>.md` 且该文件真实存在**（`check-schema-decisions` 强制）。
4. **前端只走 HTTP**：禁止 import `modules/` `runtime/` `core/`，只能用 `src/shared/`；页面组件**不裸调 `api()`**，收口到本页 `page/<name>/api.ts`（eslint 强制）。
5. **测试不碰真实库**：一律 `tests/support/test-store.mjs` 的临时库；动真实库前先 `node bin/kv.mjs db backup`。

## 事实现查（不要记数字、不要信旧文档）

```powershell
node bin/kv.mjs routes                      # 全部命令 ↔ 路由（条数以输出为准）
node bin/kv.mjs routes --module <id>        # 某模块有哪些入口
node bin/kv.mjs help --json                 # 可解析的命令表
grep -n CURRENT_SCHEMA_VERSION src/core/db/version.ts   # schema 版本
ls src/core/db/migrations/*.sql             # 迁移到尾号
ls src/modules/                             # 现存模块（历史模块会被删，别照旧记忆写）
pnpm run                                     # 全部脚本（lint/typecheck/build/test…）
```

> 本 skill 记的是**动作**，代码是唯一真相。步骤里的路径不存在时，先跑 `T09-定位代码` 重新定位，再回来修这条 SOP。
