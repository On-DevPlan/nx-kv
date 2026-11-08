# 2026-11-08 · 删除 task_refs（v2 迁到 task_attach）

- date: 2026-11-08
- drops: task_refs
- replaced-by: task_attach
- decision: 在 v2 迁移里直接 `DROP TABLE task_refs`，不留兼容壳。任务 ↔ 资源的语义迁到 `task_attach`（role: inline / attach / doc）。
- producers: 无。v1 的代码路径从未写入 `task_refs`（v1.sql 里建了表，但 modules/localtask、tasktool 均无 INSERT）。
- consumers: 无。没有任何 SELECT/JOIN 指向 `task_refs`。
- evidence: 迁移前在真实库副本上核查 `SELECT count(*) FROM task_refs` = 0；全仓 grep `task_refs` 仅命中 DDL 与决策/迁移文档。三项判据（无写入方、无读取方、无存量数据）同时满足。
- impact: 删除空表；旧 role 语义完整保留在 `task_attach` 的 CHECK 与注释里。
- alternatives: 保留为 deprecated 视图——没有消费者，视图只会制造「似乎还在用」的错觉；否决。
