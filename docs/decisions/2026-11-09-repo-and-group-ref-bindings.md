# 决策：参考仓库的组级与仓库级绑定并存（补录而非迁移）

- date: 2026-11-09
- status: accepted
- supersedes: `2026-11-09-group-level-refs.md` 中「只绑组、没有仓库级绑定」的口径
- schema: 不变（保持 v4）
- tool: `nx-kv repo ref backfill <v3.db> [--dry-run]`（`src/modules/repos/ref-backfill.js`）
- producers: `src/modules/repos/ref.js`（bindTarget / setLinkNote）、`src/modules/repos/transfer.js`（导入）、`src/modules/repos/ref-backfill.js`
- consumers: `src/modules/repos/ref.js`（refsForRepo / checkRefs）、`src/modules/repos/service.js`（assembleStore / updateRepo / removeRepo）、`src/modules/docs/knowledge.js`、`src/modules/repos/transfer.js`（导出）、面板参考仓库页

## 背景

v4（2026-11-09）把参考仓库的绑定从「仓库级」搬到了「组级」：迁移完成后，
`repos.ext.ext_linked` 里的 20 条 dev 侧 `{kind:'ref'}` 被清空，改写成 22 条
`group_refs`。事后用户澄清模型：

> 参考仓库既可以绑定到组，也可以绑定到单个开发仓库，两者并存；不是二选一，也不是继承。

因此需要把被搬走的 20 条仓库级绑定恢复回来，与现有 22 条组级绑定并存。

## 决策

**用可重复执行的补录工具，不升 v5 迁移边。**

理由：

1. **存储形状没变**：仓库级绑定本来就有位置——`repos.ext.ext_linked`（dev 侧
   `{kind:'ref', id, note?}`），`repoRowToStore` / `repoToRow` 一直支持读写。
   这次没有新增表或列，升版本只会得到一条「schema 没变化」的空迁移。
2. **数据源是某一份特定快照**：20 条绑定来自 v3 快照
   `~/.nx-kv/backups/nxkv-v3-20261109115623-pre-v4.db`。迁移边会对**每个库**执行，
   而别的库没有这份快照、也不该被强制补录；工具命令才能做到「显式、可预演、
   可审计」。
3. **补录是幂等的**：按 `(repo key, ref key)` 合并，已存在就跳过。重复执行第二次
   新增 0 条，不会产生重复绑定。
4. **只写一个维度**：工具只改 dev 的 `linked`，完全不碰 `group_refs`；组级绑定
   在补录前后逐条不变。

## 数据源与精确清单（20 条）

以 v3 快照中 dev 仓库的 `ext_linked`（`kind='ref'`）为准，按仓库 key 合并：

| 开发仓库 key | 条数 | 参考仓库 key |
|---|---:|---|
| `github.com/zhlx2005/nx-pg` | 11 | `github.com/graphif/extension-more-shape-entity`、`github.com/graphif/extension-complexity-analysis`、`github.com/graphif/project-graph-global-search`、`github.com/graphif/docs`、`github.com/graphif/graph-video-player`、`github.com/graphif/extension-text-replace`、`github.com/graphif/extension-uml-class-entity`、`github.com/graphif/extension-text-node-todolist`、`github.com/graphif/project-graph`、`github.com/graphif/extension-performance-test`、`github.com/graphif/assets` |
| `github.com/on-devplan/nx-rh` | 3 | `github.com/vercel-labs/skills`、`github.com/typicode/json-server`、`github.com/javimosch/adminer-node` |
| `github.com/on-devplan/nx-rp` | 4 | `github.com/zvec-ai/zvec-grep`、`github.com/zvec-ai/zvec-node`、`github.com/alibaba/zvec`、`github.com/tencent/teamai-cli` |
| `github.com/zhlx2005/cs-wd` | 2 | `github.com/microsoft/powertoys`、`github.com/openai/codex` |
| **合计** | **20** | |

规则：快照里没有的仓库/参考仓库 -> 报告为 `missing` 并跳过（不造脏数据）；
快照里同一仓库重复出现的 ref -> 去重；note 只在该绑定还没有 note 时补写。

## 补录前后计数（真实库，2026-11-09）

| 指标 | 补录前 | 补录后 |
|---|---:|---:|
| 仓库级绑定（dev.linked kind=ref） | 0 | 20 |
| 组级绑定（group_refs） | 22 | 22（未变） |
| 有仓库级绑定的仓库 | 0 | 4 |
| 有组级绑定的组 | 4 | 4 |

重复执行（第二次）结果：新增 0，已存在 20，仓库级仍为 20。

## 等价性核对（v3 快照 vs 补录后）

对每个参考仓库逐条比较「绑定的组集合」与「绑定的仓库集合」：

- v3 侧：仓库级 = dev 的 `ext_linked`；组级 = 参考的组成员关系 ∪ 其绑定仓库所属组。
- 补录后：仓库级 = dev 的 `ext_linked`；组级 = `group_refs` ∪ 参考的组成员关系
  ∪ 其绑定仓库所属组。
- 结果：**20 个有关系的参考仓库，0 差异**；仓库级 20 = 20，组级 22 = 22。

## 语义约定（与 v4 相同的部分 / 更正的部分）

- 仍然**没有继承、覆盖、排除**；两类绑定是并列关系，读取时不合并、不推导。
- 更正：`repo bind --repo` 不再解析到「该仓库所属的每个组」，而是直接写该仓库的
  仓库级绑定；`--board` 写组级。两者可以同时给。
- `repo ref note --repo` 写仓库级描述，`--board` 写组级描述；一条关系一条描述。
- 删除参考仓库 / 参考仓库转 dev：组级（FK CASCADE）与所有仓库的仓库级绑定
  （显式清理）一起摘除，不留死链。
- `repo ref of` 先列直接绑定到本仓库的参考，再按组列组级参考；
  `repo ref check` 分别报告 `groups` 与 `repos` 两类绑定对象。
- 布局导出导入：同一条 link 的 `to` 里可以同时出现 `{board}` 与 `{repo}`。

## 影响文件

- `src/modules/repos/ref-backfill.js`（新增）
- `src/modules/repos/ref.js`（bindTarget / setLinkNote / refsForRepo / checkRefs / cloneRef）
- `src/modules/repos/index.js`（新增 `repo ref backfill`；命令摘要与渲染）
- `src/modules/repos/service.js`（参考仓库改 key / 转 dev 时同步清理仓库级绑定）
- `src/modules/repos/transfer.js`（导出/导入支持 `to.repo`）
- `src/modules/docs/knowledge.js`（仓库上下文并入仓库级参考）
- `src/web/frontend/page/repos/index.jsx` + `src/web/frontend/style.css`（参考仓库页两类勋章、可跳转、折叠）
- 测试：`tests/unit/repos-ref.test.mjs`、`repos-relations.test.mjs`、`repos-repo.test.mjs`
- 文档：`assets/kv-repo/SKILL.md`、`assets/nx-kv/references/repo-registry.md`、
  `.claude/skills/dev-nxkv/references/domain-model.md`、本目录两份 v4 文档的补记
