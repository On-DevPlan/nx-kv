# 功能点 SOP

一条规则一句；不要从「先写代码」开始。

## 0. 需求定性

- 先写清业务对象：队列 / 任务 / 仓库 / 组 / 文档 / 附件 / 时间目标 / 设置 / 模板。
- 分清「新增能力」还是「修正行为」；修正行为先找唯一入口，不复制第二条路径。
- 列出涉及层：schema、repo/service、action、面板、内置技能/文档。
- 用一句可观察、可命令验证的话定义「完成」。

## 1. 侦察

- 读 `SKILL.md` → `domain-model.md` → `module-skeleton.md` → `action-contract.md`。
- 涉及提示词读 `prompt-system.md`；涉及依赖/顺序读 `dag-system.md`。
- 读目标模块 `index.js` → `service.js` → `repo/*.js` → 相关 `core/*`。
- 读 `tests/unit/` 与 `tests/smoke.mjs`，它们定义既有契约。
- 用 `node bin/cli.mjs routes --module <id>`、`help --json`、`db status`、`db verify` 核对，不猜数据。
- 产出一张「入口 → service → repo → 表/设置键 → 前端」路径图；找不到唯一入口先停下讨论。

## 2. 先定数据

- 需要查询、外键、事务或唯一约束 → SQLite 新表/新列，只加 `vN.sql` 并在 `migrations/index.js` 登记边。
- 已发布的迁移文件不可改；数据库只升不降，库版本高于程序时启动直接拒绝。
- 小旋钮、提示词配置进 `settings` 的 `lt.*`；用户偏好进 `app.*`；凭据只进 `config.json`。
- 永远不进 WHERE 的展示信息进 `<table>.ext`，键名带 `ext_`；要过滤的字段不许进 ext。
- 任务正文模板进 `templates`；提示词区块模板进 `settings.lt.blockTemplates`，两者严格分开。
- 定身份：队列 `id`（外键）/ `key`（寻址）；任务 `id`（外键）/ `seq`（对外编号）。
- 新增查询一律带 `deleted_at IS NULL`，不要一条软删、一条硬删。
- 多表/多行写入放同一个 `txw(...)`，事务回调内禁止 `await` 非同步 IO。
- 并发新增先想清楚编号、key、唯一索引冲突；分配与插入同事务。
- 迁移函数必须幂等；运行时不做旧数据兼容，兼容只写在迁移脚本里。

## 3. 后端

- SQL 只写在 `modules/<id>/repo/*.js`，时间统一用 `nowMs()`。
- 业务规则、事务边界、错误语义放 `service.js`；action 不拼 SQL。
- action 在 `modules/<id>/index.js`：`id` 全局唯一、`cli` 必填、`http` 给出或用 `null`、`summary` 一句话、`args/flags` 标类型与提示。
- `run` 只做编排与入参归一，`render` 负责人读输出；`rest` 字段未启用。
- 重依赖可延迟 import，但不要制造循环依赖。

## 4. 面板

- 页面放 `src/web/frontend/page/<name>/` 并在 `src/web/frontend/registry.js` 登记；设置页放 `page/settings/`。
- 前端只调 `/api/*`，禁止 import 后端模块，只能用 `src/shared/` 纯函数。
- 复用现有 section/编辑器组件，不为同一功能再写一套表单。
- 任务模板与提示词区块模板分开展示；区块模板按区块各自一份列表。

## 5. 测试

- 行为变化在 `tests/unit/` 加/改用例，命名 `<domain>-<behavior>.test.mjs`。
- DB 改动同时跑 `pnpm test:db`，覆盖多队列、并发、历史格式、软删、外键。
- 渲染改动覆盖：保存拒坏语法、运行期回落 + `renderWarnings`、列表循环、旧配置迁移。
- 所有测试走 `tests/support/test-store.mjs` 临时库，禁止指向真实 `~/.nx-kv/nxkv.db`。

## 6. 验证

- 基线：`pnpm test`（lint + build + smoke + unit）。
- 渲染/提示词：`localtask preview --id` + 一次真实 `localtask get` 载荷。
- DB：`db backup` → `db migrate --dry-run`（演练）→ `db migrate` → `db verify`。
- 面板：真实打开页面，验证布局、交互、空态与错误态。

## 7. 文档

- CLI/面板行为变化同步 `README.md` 与 `docs/project&projectsCli.md`。
- 安装后 agent 用法变化同步 `assets/`（`nx-kv/`、`kv-get/`、`kv-submit/`、`kv-repo/`）与 `assets/groups.json`。
- 用户可见变化记入 `CHANGELOG.md`。
- 改本 skill 时同步 `.claude/skills/dev-nxkv/`。

## 8. 提交与汇报

- 提交信息用 Conventional Commits，正文用中文说明「为什么」。
- 只 `git add` 本次自己改的文件，不要 `git add -A`。
- 用户未明确要求发布时不 push、不强推。
- 汇报必须回答：改了哪些文件、数据模型变化、入口变化、验证命令与真实结果、渲染/DB 证据、未做事项与风险。

## 9. 高频坑

- 用旧 JSON 文件思路改数据——本项目是 SQLite。
- 新增第二条渲染/领取路径，绕过 `buildTaskDelivery`。
- 把 `seq` 当外键、把 `tasks.id` 当 CLI 编号。
- 软删只做一半，查询漏 `deleted_at IS NULL`。
- 测试指向真实库，污染用户任务与设置。
- 完整清单见 `pitfalls.md`。
