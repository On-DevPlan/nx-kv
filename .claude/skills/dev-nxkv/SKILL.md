---
name: "dev-nxkv"
description: "nx-kv 仓库开发指引：分层与 action 契约、SQLite 领域模型、Handlebars 提示词模板、DAG、验证与功能点 SOP。改 nx-kv 代码、加 action/CLI/面板/表、改提示词渲染或依赖判定时使用；仅使用 nx-kv 领任务/提交任务时不要用。"
---

# nx-kv 开发 skill（索引）

本文件只做索引。细节按下方顺序读 references；不要在这里展开实现。

## 什么时候触发

- 修改 `nx-kv` 仓库源码：新增/修改 action、CLI、HTTP、面板、数据库表、设置项、提示词渲染、依赖/闸门。
- 需要判断改动该落在 `core` / `shared` / `modules/<id>` / `web/frontend` 哪一层。
- 需要交付验收证据（lint、单测、smoke、build、真实渲染输出）。
- 不适用：只是用 `nx-kv` 领取/提交任务、查询清单、安装该 CLI 的用户侧操作（看 `README.md` 与 `docs/`）。

## 不可省略的硬约束

1. 功能入口只走 `src/modules/<id>/index.js` 的 action；**每条 action 必须有 `cli`**，`http` 可显式为 `null`。
2. 模块间只通过对方 `service.js`/导出面协作；禁止 import 别的模块内部实现（见 `eslint.config.js`）。
3. 跨模块、无副作用的纯函数才放 `src/shared/`；`src/core/` 只放原语（db、错误、模板引擎等），不放业务。
4. SQLite 是唯一业务数据源。schema 只加新 migration：`src/core/db/migrations/vN.sql`（不可变快照，当前 `v2.sql`）+ `migrations/index.js` 登记直接边/组合边；**禁止改已发布版本文件**。
5. 提示词只走「一份共享 ctx + Handlebars 模板字符串 + 薄编排」。禁止自研解析器、区块对象、每块独立变量域、服务端预拼列表文本。
6. 测试必须用临时库/临时目录（`tests/support/test-store.mjs`）；禁止写用户真实库。真实库操作前先 `nx-kv db backup`。
7. 改 CLI、面板、内置技能行为时，同步 `README.md`、`docs/`、`assets/` 与 `.claude/skills/`，不要只改一处。

## 阅读顺序与 references

必读顺序：1 → 2 → 3 →（按需 A/B）→ 4 → 5 → 6。

| 顺序 | 文件 | 一句话说明 | 何时读 |
|---|---|---|---|
| 1 | [domain-model.md](references/domain-model.md) | 以真实表结构讲核心概念、术语规范、表间关系与设置键组织 | 任何改动前，先建立领域模型 |
| 2 | [module-skeleton.md](references/module-skeleton.md) | 分层、目录、模块/仓储/前端骨架与新增模块步骤 | 决定改哪一层、怎么落文件 |
| 3 | [action-contract.md](references/action-contract.md) | action 字段、CLI/HTTP 契约、参数与渲染、注册校验 | 新增或修改命令/接口/面板入口 |
| A | [prompt-system.md](references/prompt-system.md) | Handlebars 选型、共享 ctx、语法约束、区块设置与迁移 | 动提示词、模板、交付上下文、设置页 |
| B | [dag-system.md](references/dag-system.md) | 任务依赖、闸门、引擎投影与看板展示的真实存储口径 | 动依赖/顺序/工作流/看板 |
| 4 | [feature-sop.md](references/feature-sop.md) | 一个功能点从提出到验收的标准动作清单 | 接到功能需求后照着做 |
| 5 | [verification.md](references/verification.md) | 两层渲染校验、固定检查项、真实渲染证据与测试隔离 | 编码完成、准备汇报前 |
| 6 | [pitfalls.md](references/pitfalls.md) | 本项目已踩过的坑与反模式，附正确做法 | 设计评审与提交前自检 |

## 仓库事实入口（需要核对时先看这些）

- 命令与路由：`node bin/cli.mjs routes --module <id>`、`node bin/cli.mjs help --json`
- 表结构：`src/core/db/migrations/v2.sql`（最新快照；历史 `v1.sql` 永远不改）
- 设计取舍：`docs/research/SQLITE-SCHEMA.md`、`docs/research/template-engine-choice.md`
- 使用者文档与变更记录：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`
