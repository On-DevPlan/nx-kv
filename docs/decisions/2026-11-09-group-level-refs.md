# 决策：参考仓库绑定升到组级（group_refs）

- date: 2026-11-09
- status: accepted
- schema: v4（`src/core/db/migrations/v4.sql` + `v4-data.js`）
- tables: group_refs
- producers: `src/modules/repos/service.js`（persistStore 随组落库整组重建）、`src/modules/repos/ref.js`（bindTarget / setLinkNote）、`src/modules/repos/transfer.js`（导入）、`src/core/db/migrations/v4-data.js`（迁移搬运）
- consumers: `src/modules/repos/service.js`（assembleStore，board.refs）、`src/modules/repos/ref.js`（refsForRepo / refsForBoard / checkRefs）、`src/modules/repos/boards.js`（面板组视图）、`src/modules/docs/knowledge.js`（仓库上下文）、`src/modules/repos/transfer.js`（导出）、面板仓库页组视图

## 背景

参考仓库（type=ref）原先通过 `repos.ext.ext_linked` 双向记录在仓库与看板上：
ref 侧存 `{kind:'repo'|'board'}`，dev 侧存反向 `{kind:'ref'}`。实际使用中，
用户按**组**看参考时看不到仓库上绑定的参考；而组的语义单位本来就是「一个领域
共享同一批参考资料」，逐个仓库绑定既重复又容易漏。

## 决策

1. 参考仓库**只绑定到组**（`repos.type='group'`），组内所有仓库共享。
   新建 `group_refs(group_key, ref_key, note, position, created_at)`，
   两端 FK `repos(key)`，PK `(group_key, ref_key)`。
2. **不做继承**：没有「组绑定 + 仓库绑定叠加」，没有覆盖 / 排除 / 解绑表达式，
   读取时不产生来源标记。`note` 只描述「这个组为什么参考它」。
3. `repo bind --repo` 保留为便捷入口：解析该仓库所属的每个组并绑定；
   仓库不属于任何组时显式报错，不落无人可见的仓库级绑定。
4. 数据迁移：ref 侧的 board 绑定直接落表；repo 绑定与 dev 侧反向引用解析到
   目标仓库所属的每个组，同组同参考合并；已迁移条目从 ext 删除。
   **无归属组仓库的旧绑定原样保留**（不静默丢弃），由 `repo ref check` 报「未迁移」。
5. 删除组 → `group_refs` 随之清理（写入层显式清 + FK 兜底）；删除参考仓库
   → 从所有组摘除；参考仓库转 dev → 从所有组摘除。

## 影响

- 读取：`refsForRepo` 按仓库所属组返回；`refsForBoard` 只读组绑定。
- CLI / 面板 / skill 描述同步为「组级共享」口径；`repo ref of` 不再有
  「第一层直接绑定 / 第二层继承」两层。
- 迁移实测：20 条仓库级绑定 → 22 条组级绑定（nx 18 / csharp 2 / quickget 2，
  nx 组内两仓库重复的 2 条合并）；无组仓库 0 个，无绑定丢失。

## 补记（2026-11-09，口径更正）

本决策第 1、2、5 条里「只绑组 / 没有仓库级绑定」的表述**作废**。用户澄清：
**组级与仓库级不是二选一**，参考仓库既可以绑组，也可以绑单个开发仓库，两者并列
存在、互不折算。v4 把 20 条仓库级绑定搬成组级后，需要把它们恢复回来与
`group_refs` 并存；恢复用可重复执行的补录工具而非 v5 迁移，理由与核对结果见
[2026-11-09-repo-and-group-ref-bindings.md](./2026-11-09-repo-and-group-ref-bindings.md)。

保留不变的部分：仍然**没有继承/覆盖/排除**；`repo bind --repo` 不再解析到组，
而是直接写仓库级绑定。
