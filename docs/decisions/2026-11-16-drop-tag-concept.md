# 2026-11-16 · 去掉「分类标签」概念（tag）

- date: 2026-11-16
- status: 已实施
- decision: **文档绑定不再有「分类标签」**。原来 `repo doc add --tag qa` / `docs link --tag`
  写的那套分类值，在整个应用里**没有落点**：面板没有编辑入口、检索几乎不用，
  却让宿主 ext（`docLinks[].tag`）、`ref_bindings` 索引、API 形状、CLI 输出到处背着一个字段。
  本次把这条概念从根上删掉。
- tables: `ref_bindings`（**删** `tag` 列）、`link_notes`（新增）
- drops: `ref_bindings.tag`（列，非表）
- producers: `repo doc add` / `docs link`（附件注解只剩 `note`）
- consumers: 文档绑定视图、仓库文档列表、知识索引、导出格式
- migration: `src/core/db/migrations/v12.sql`（11 → 12）+ `v12-data.ts`（搬关系描述定位）

## 1. 为什么不是「留着但不用」

一个既没有入口、又不参与任何判定的字段，会一路传染：ext 形状里带着它、索引列里带着它、
API 契约里带着它、导出文件里带着它、前端渲染还要给它留 chip 样式。
五年后没人知道它是干什么的，但谁都不敢删——这就是无效概念的定义。

## 2. 关系描述文档的定位怎么办（#134 的机制不能跟着一起删）

#134 把「组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库」这条关系的描述归档成
**这个参考仓库上的一篇文档**，定位靠 `ref_bindings.tag = link-note:<关系 key>`。
它借用了 tag 列，但**它不是分类标签**——它是一条真实关系指向一篇文档的索引。

所以 v12 做了两件事：

- `ALTER TABLE ref_bindings DROP COLUMN tag` —— 分类标签连同索引列一起消失；
- 新表 `link_notes (scope_key PRIMARY KEY, ref_id, created_at)` —— 承接关系 → 描述文档的定位；
  `scope_key` 就是关系 key（`board/<组key>` / `repo/<仓库key>`）。

数据迁移（`v12-data.ts`）把既有的 `link-note:%` 搬进新表，**其余分类标签直接丢弃**
（它们从来没有入口，从来没人用过）。

## 3. 不变式

- 文档本体（`refs` / `ref_bodies`）与归属关系（`ref_bindings` 的其余列）**一字不动**；
- 关系描述文档仍然一篇对一关系，重复写只是改内容；
- 附件注解仍然有 `note`（一句话说明）——那是有用的，不在本次删除范围。
