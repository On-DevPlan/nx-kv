# 2026-11-15 · 孤儿 ref 到期清理（3 天）

- date: 2026-11-15
- status: accepted
- producers: `src/modules/docs/orphan.ts`（判定 / 预演 / 清理），`src/core/db/migrations/v11-data.ts`（存量回填）
- consumers: `docs orphans` / `docs orphans purge`（CLI + HTTP），设置面板「文档清理」，serve 例行维护

## 背景

`refs` 与 `ref_bindings` 是「文档本体 / 宿主归属」两层：宿主 ext 是语义权威，
`ref_bindings` 是可重建的索引。解绑、摘除文档集、重建索引都会让某些 ref 不再有
任何归属，但此前没有任何对账或回收逻辑，孤儿 ref 会永久留在库里。

用户要求：孤儿满 3 天后自动删除，且删除前可看清单、删除后可审计。

## 定义

**孤儿 = `deleted_at IS NULL` 且 `ref_bindings` 中没有任何一行的 ref。**

判定不看 `state`（`state` 只是索引结果的冗余标记），但写路径会同步维护它。
`refs.orphan_since` 记录「失绑起算时间」：

- 0 = 未计时（有归属，或尚未被维护任务起算）；
- > 0 = 从该毫秒时刻起算 TTL。

由「有归属」变成「无归属」时写入当前时刻；已经是孤儿时重建索引**不刷新**起算
时间（否则每次 `syncRefIndex` 都会把倒计时重置，永远到期不了）。

## 删除方式：软删 + 不可变留痕

选择 `UPDATE refs SET deleted_at = ?`，而不是 `DELETE FROM refs`：

1. 用户明确要求「不要自己决定不可逆的部分」；软删可回滚。
2. `ref_bodies` 保留，正文不会因为一次维护就丢；需要物理回收时可另行操作。
3. 所有业务读路径都已过滤 `deleted_at IS NULL`（`resolveRefId` / `refDocById` /
   `listRefDocs` / `externalClosure` 等），软删在语义上等价于删除。

代价：软删行会一直占位；同一 `refId` 显式重新登记时需要在 `ensureDocRef` 里恢复
（清 `deleted_at`），否则会得到一个「存在但不可见」的 ref。

每次清理在 `ref_gc_log` 写一条不可变记录：ref_id、desc、origin、body_bytes、
unbound_at、deleted_at（清理时刻）、ttl_days、reason、source、snapshot。

## 有正文的孤儿：不自动删

自动清理只处理**空正文**（`ref_bodies` 缺失或 trim 后为空）的到期孤儿。
有正文的到期孤儿会出现在清单和面板里，标记「有正文，需人工处置（未自动清理）」，
并计入 `skippedWithBody`；不做静默删除。人工处置走既有的 `docs delete <refId>`
（物理删除，明确的手动动作）。

理由：正文是用户资产，自动清理无法判断它是否还有价值；空壳没有这个风险。

## TTL 配置

`settings` 表 `app.orphanTtlDays`，默认 3 天，范围 1–3650。CLI/面板都可改；
清理命令可用 `--ttlDays` 临时覆盖（便于演练），但不落库。

## 触发

- serve 启动后延迟执行一次，之后每小时一次（timer `unref`，不阻塞退出）；
- `nx-kv docs orphans purge` 手动触发，默认 dry-run，`--apply` 才软删；
- `nx-kv docs orphans` 只读清单（失绑时间 / 剩余天数 / 是否到期 / 是否有正文）。

## 被否决的方案

- **物理删除**：不可逆，且会让 `ref_gc_log` 失去可回查的关联；不适合自动维护。
- **删除有正文的孤儿**：与「不能静默删用户内容」冲突。
- **不落 `orphan_since`，用 `state` 变化时间推算**：`refs` 没有状态变更时间字段，
  `updated_at` 会被正文/描述更新污染，无法得到真实失绑时刻。
- **每次重建索引都刷新起算时间**：倒计时被无限重置，规则失效。
