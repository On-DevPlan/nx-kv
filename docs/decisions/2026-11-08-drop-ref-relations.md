# 2026-11-08 · 删除 ref_relations（v2 迁到 ref_attach）

- date: 2026-11-08
- drops: ref_relations
- replaced-by: ref_attach
- decision: 在 v2 迁移里直接 `DROP TABLE ref_relations`，文档正文引用的资源关系改由 `ref_attach` 承载（role: inline / attach / reference）。
- producers: 无。v1 未接线（无 INSERT/UPDATE）。
- consumers: 无。没有 SELECT/JOIN 指向 `ref_relations`。
- evidence: 迁移前真实库副本 `SELECT count(*) FROM ref_relations` = 0；全仓 grep 仅命中 DDL 与决策/迁移文档。
- impact: 删除空表；文档资源关系改走 `ref_attach`，与任务侧 `task_attach` 结构对称。
- alternatives: 保留并双写——双写会立刻产生两份真相，且没有历史数据需要兼容；否决。
