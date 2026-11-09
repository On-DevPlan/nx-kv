---
name: "dev-nxkv"
description: "nx-kv 仓库开发指引：分层与 action 契约、SQLite 领域模型（v2）、Handlebars 提示词模板、DAG、迁移与验证。改 nx-kv 代码、加 action/CLI/面板/表、改提示词渲染或依赖判定时使用；仅使用 nx-kv 领任务/提交任务时不要用。"
---

# nx-kv 开发 skill（索引）

本文件只做索引，细节按下表读 references。

## 触发

- 改 `nx-kv` 源码：action、CLI、HTTP、面板、表、设置项、提示词渲染、依赖/闸门。
- 判断改动落在 `core` / `shared` / `modules/<id>` / `web/frontend` 哪一层。
- 交付验收证据（lint、单测、smoke、build、真实渲染输出）。
- 仅使用 CLI（领任务/提交/查清单）不属于本 skill。

## 硬约束

1. 功能入口只走 `src/modules/<id>/index.js` 的 action；每条 action 必须有 `cli`，`http` 可显式 `null`。
2. 模块间只通过对方 `service.js` 或公开导出面协作，禁止 import 别的模块内部文件。
3. `src/core/` 只放原语，`src/shared/` 只放无副作用纯函数，业务留在模块 service。
4. SQLite 是唯一业务数据源；新 schema 只加 `vN.sql` 并在 `migrations/index.js` 登记边，已发布文件不可变。
5. 迁移：启动时检查版本，落后则自动升级且先备份，库版本高于程序则拒启动；运行时不做旧数据兼容，兼容只存在于迁移脚本。
6. 提示词只走「一份共享 ctx + Handlebars 模板字符串 + 每区块模板列表 + 附件按类型分节」，禁止自研解析器、区块对象、每块独立变量域。
7. 测试必须用临时库/临时目录（`tests/support/test-store.mjs`）；禁止写用户真实库。真实库操作前先 `nx-kv db backup`。
8. 改 CLI/面板/内置技能行为时，同步 `README.md`、`docs/`、`assets/` 与 `.claude/skills/`。

## references

| 顺序 | 文件 | 一句话说明 | 何时读 |
|---|---|---|---|
| 1 | [domain-model.md](references/domain-model.md) | v2 表结构、术语规范、表间关系、设置键 | 任何改动前 |
| 2 | [module-skeleton.md](references/module-skeleton.md) | 分层、目录、模块/仓储/前端骨架、新增模块步骤 | 决定改哪一层 |
| 3 | [action-contract.md](references/action-contract.md) | action 字段、CLI/HTTP 契约、参数与渲染、注册校验 | 新增/改命令或接口 |
| A | [prompt-system.md](references/prompt-system.md) | 共享 ctx、语法约束、六区块模板、附件分节、设置页 | 动提示词/模板/交付上下文 |
| B | [dag-system.md](references/dag-system.md) | 依赖、闸门、引擎投影与看板展示口径 | 动依赖/顺序/工作流 |
| 4 | [feature-sop.md](references/feature-sop.md) | 一个功能点从需求到验收的动作清单 | 接到功能需求 |
| 5 | [verification.md](references/verification.md) | 固定检查项、两层渲染校验、测试隔离、汇报格式 | 编码完成/汇报前 |
| 6 | [pitfalls.md](references/pitfalls.md) | 已踩过的坑与反模式 | 设计评审/提交前 |

## 事实入口

- 命令与路由：`node bin/cli.mjs help --json`、`node bin/cli.mjs routes --module <id>`
- 表结构：`src/core/db/migrations/v1.sql`（基础全量）、`v2.sql`（当前过渡）、`migrations/index.js`（版本边）
- 设计取舍：`docs/research/SQLITE-SCHEMA.md`、`docs/research/template-engine-choice.md`
- 使用者文档：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`
