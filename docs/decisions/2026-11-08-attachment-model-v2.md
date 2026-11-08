# 2026-11-08 · 统一资源表与任务/文档资源关系（存储版本 2）

- date: 2026-11-08
- decision: 新增 `attachments` 作为资源统一中心；任务侧关系表 `task_attach`、文档侧 `ref_attach`；`refs` 收窄为纯文档库（只装 md）。正文 `![名](fileId)` / `[名](fileId)` 写法保持不变，fileId 与 `attachments.id` 对齐。
- tables: attachments, task_attach, ref_attach
- producers: 逐表见下表「生产」
- consumers: 逐表见下表「消费」
- 逐表生产/消费:
  - attachments — 生产: `core/attachmentdb.js`（正文解析 upsert、上传登记、URL/task/ref 解析）、`core/localatt.js` 上传、v2 迁移 `migrations/v2-data.js`；消费: 任务/文档附件清单、领取交付标注、孤儿池（`listOrphans`）、面板附件区。
  - task_attach — 生产: 正文同步 `syncTaskAttachments`、CLI/面板 `attach --no-embed`（`linkAttachment`）；消费: `annotateTaskDelivery`、`localtask attachments`、面板任务附件区。
  - ref_attach — 生产: 正文同步 `syncRefAttachments`、`docs attach --no-embed`；消费: `docs attachments`、面板文档附件区、导出/迁移核查。
- evidence:
  - 真实库副本迁移结果：attachments=34（33 条 manifest 台账 + 1 条 URL）、task_attach=43、ref_attach=1、legacyManifest=33；正文 fileId 提及 43 处与 task_attach 43 条一一对应；manifest 有、正文无引用的 1 条成为**无关系**的资源行，未误挂任何任务。
  - 旧 `task_refs`/`ref_relations` 均为 0 行且无读写方（见两份删除决策）。
- impact: 附件元数据不再以 `manifest.json` 为真相（迁移后归档，库为唯一真相）；正文只是 `role=inline` 那一部分的呈现，关系表是附件清单的权威。
- alternatives: 单张多态关系表（宿主 task/ref 混存）——外键无法同时指向 `tasks` 与 `refs`，级联语义只能退化为应用层维护，role 校验也不得不放宽；否决。继续以 manifest.json 为真相——两套真相、删除任务无法收敛孤儿；否决。
