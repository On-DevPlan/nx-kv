# 2026-11-14 · 任务新增 plan 临时草稿态

- date: 2026-11-14
- status: 已实施（#126）
- decision: `tasks.status` 增加第五个值 `plan`。它是**不进队列的临时态**：头脑风暴时把想法写成任务存进库，但不被 `localtask get` / `wait` / 主题队列领取，也不参与闸门与依赖推进；可以随时转回 `pending`。
- tables: tasks（重建，仅扩 `status` 的 CHECK；列与索引、触发器原样保留）
- drops: tasks, _v9_task_links, _v9_task_deps, _v9_goals, _v9_task_attach
  - 说明：tasks 是 12-step 重建；四个 `_v9_*` 是关系表 TEMP 快照，回填后立即删除。
- producers: `localtask.plan`（CLI/HTTP）、任务面板工具栏的「转为草稿 / 转回待领取」
- consumers: `src/shared/task-status.ts`（状态词表与正判定）、面板待领取列表与状态药丸
- migration: `src/core/db/migrations/v9.sql`（8 → 9）

## 1. 为什么是 status 而不是 ext 里的旗标

全链路的待领取判据都是 **`status === 'pending'` 的正判定**（见 `src/shared/task-status.ts`
的注释：排除法会让任何新状态变成可领取任务）。让 `plan` 成为真正的 status：

- 所有取任务 SQL（`WHERE status='pending' …`）、闸门扫描、跨队列总览**一行都不用改**；
- `isPending()` / `isOpenTask()` 天然为 false；
- 迁移漏掉一条也不会出现「草稿被 agent 领走干一遍」的静默事故。

代价是 SQLite 不能 ALTER 既有 CHECK，需要重建 `tasks`。沿用 v5 已验证过的
快照 → 建新表 → 搬数据 → DROP → RENAME → 重建索引/触发器 → 回填关系表 模式。

## 2. 语义边界

| 项 | plan 态 |
| --- | --- |
| 存储 | 与普通任务同一张 `tasks` 表，正文/附件/时间目标声明都照常保存 |
| `localtask get` / `wait` / 全局池 | 不参与（不是 pending） |
| 闸门 / DAG 依赖扫描 | 不参与（扫描只看 pending） |
| 面板 | 单独标「草稿」，不与待领取数混在一起 |
| 转换 | `localtask plan --id N --to plan\|pending`，只允许 `pending ↔ plan` 双向切换；claimed/done/cancelled 不允许直接转 |

## 3. 不变式

- 迁移前后 `tasks` 行数、`task_links` / `task_deps` / `goals` / `task_attach` 行数完全一致；
- `trg_tasks_identity` 与两个索引原样重建；
- 旧库（v8）启动时自动 8 → 9 升级，升级前按既有管线备份。
