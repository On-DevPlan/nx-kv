# ref 管理体系

> ⚠️ **历史快照（2026-11-12 写于 v6 之前）**：本文描述的是「正文在文件、DB 只存索引、
> 有约定路径（`repo/<key>/index.md` 等）」那一代模型，**已经不是当前实现**。
> 当前模型：ref 的地址只有 `refs.id` 与 `refs.locator`（没有逻辑名、没有约定路径），
> 正文在 `ref_bodies`，归属以 `ref_bindings` 为唯一真源。
> 见 [decisions/versions/2026-11-13-v8.md](decisions/versions/2026-11-13-v8.md)
> 与 [glossary.md](glossary.md)。下文保留原文，供追溯当时的问题与结论。

> 事实来源：`src/core/db/migrations/*.sql`、`src/modules/docs/*`、`src/modules/repos/*` 与当时的真实库（`~/.nx-kv/nxkv.db`，只读快照）。

## 0. 一句话模型

`refs` 是**文档索引**，不是文档仓库：一行只记 locator、state 与时间戳，正文永远在文件；`ref_bindings` 记「这篇文档挂在哪个仓库/组/组内成员身上」；参考仓库（`repos.type='ref'`）的绑定走另外两张表（`group_refs` / `repos.ext.ext_linked`），和文档索引不是一回事。

## 1. ref 到底是什么

| 项 | 结论 | 依据 |
|---|---|---|
| 表里存什么 | 只存索引：`id/type/locator/state/version/deleted_at/created_at/updated_at`，**没有正文字段** | [v1.sql](file:///d:/a_js/js_proj/nx-kv/src/core/db/migrations/v1.sql#L456-L478) |
| `locator` | 自有文档写 **docs 根相对路径**（`repo/<key>.md`、`board/<slug>.md`、`group/<slug>/<repoKey>.md`）；历史导入可能残留绝对路径 | [refs.js](file:///d:/a_js/js_proj/nx-kv/src/core/db/import-json/refs.js#L15-L34) |
| `refs.id` | `'ref_' + sha1(locator).slice(0,16)`，同一个 locator 永远同一个 id（天然幂等） | [ids.js](file:///d:/a_js/js_proj/nx-kv/src/core/attachmentdb/ids.js#L34-L36) |
| 物理路径 | `docsRoot()/locator`；`docsRoot = APP_DIR/docs`，`APP_DIR = NX_KV_HOME \|\| ~/.nx-kv` | [paths.js](file:///d:/a_js/js_proj/nx-kv/src/modules/docs/paths.js#L18-L20)、[core/paths.js](file:///d:/a_js/js_proj/nx-kv/src/core/paths.js#L1-L12) |
| `state=''` | 已绑定：有宿主（`ref_bindings` 有行），或索引重建时确认过 | [refs.js](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/repo/refs.js#L117-L165) |
| `state='orphan'` | 未绑定：文件在索引里，但没有任何宿主认领 | [docs.js](file:///d:/a_js/js_proj/nx-kv/src/core/attachmentdb/docs.js#L38-L50)、[listOrphans](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/repo/refs.js#L47-L58) |
| `deleted_at` | 软删；所有查询都带 `deleted_at IS NULL` | [listOrphans](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/repo/refs.js#L47-L58) |

关键点：**state 不是文件状态，是绑定状态**。文件存在但没宿主 = `orphan`；文件被删但没人重建索引 = 行还在（`''` 或 `orphan` 都可能）。

## 2. 文档来源分类

| 来源 | 会不会进 `refs` | 怎么读 | 限制 |
|---|---|---|---|
| **nx-kv 自有文档**：`docs add` / `docs set` / `docs seed` | **会**。写盘后同事务 `ensureDocRef`（固定插 `orphan`）+ `syncRefAttachments` | `doc.get`、`repo knowledge` 直接读 `docsRoot/rel` | 写入只登记不绑定；只认 docs 根下的 rel，不能指外部目录 |
| **外部绑定文件/目录**：`{path}` 型 DocRef（Obsidian vault 等） | **不会**（当前 CLI 不写 refs 行；只有历史导入可能残留绝对 locator） | `resolveExternal` 先校验绑定闭包，再读文件；目录只列文件清单，不进全文 | 必须在某个 `{path}` 绑定根之下，否则被跳过并记 warning |
| **仓库自带的 md**（README、docs/ 等） | **不会**。索引只遍历 `docsRoot`，从不扫仓库目录 | 只能①手工把它作为外部 `{path}` 文档绑定；②用参考仓库身份由 agent 自己读盘 | 不会自动出现在面板/孤儿统计；没有“仓库文档自动收录” |
| **历史导入/迁移残留**（绝对路径 locator） | 已有行保留 | 按 locator 绝对路径读，仍受绑定闭包约束 | 新增入口不再产生 |

依据：

- 写入链路：`writeOwnDoc` → `tx(ensureDocRef + syncRefAttachments)`，见 [store.js](file:///d:/a_js/js_proj/nx-kv/src/modules/docs/store.js#L75-L95)。
- 扫描范围：`listDocFiles(docsRoot)` 递归只收 docs 树的 `.md`，见 [refs.js](file:///d:/a_js/js_proj/nx-kv/src/core/db/import-json/refs.js#L15-L34) 与 [bind-topics.js](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/service/bind-topics.js#L38-L96)。
- 外部闭包：`externalClosure`（L120）/ `resolveExternal`（L157）见 [store.js](file:///d:/a_js/js_proj/nx-kv/src/modules/docs/store.js#L120-L168)。

## 3. 绑定单元：两套体系，各自分层，不要合并成一句话

库里有两个都叫「ref」的东西，分层数不同：

| 体系 | 指什么 | 绑定单元 | 存放 |
|---|---|---|---|
| 文档 ref | `refs` 表里的文档索引行 | **三层**：`repo` / `group` / `group_repo` | `ref_bindings` |
| 参考仓库 | `repos.type='ref'` 的仓库 | **两层**：组级 / 仓库级 | `group_refs` + `repos.ext.ext_linked` |

### 3.1 文档 ref：绑定单元是三层（`ref_bindings`）

DDL 原文（[v1.sql](file:///d:/a_js/js_proj/nx-kv/src/core/db/migrations/v1.sql#L499-L516)）：

```sql
CREATE TABLE ref_bindings (
  repo_key   TEXT    NOT NULL REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  group_key  TEXT             REFERENCES repos(key) ON DELETE CASCADE ON UPDATE CASCADE,
  ref_id     TEXT    NOT NULL REFERENCES refs(id)  ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('repo','group','group_repo')),
  position   INTEGER NOT NULL DEFAULT 0,
  note       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK ((type =  'group_repo' AND group_key IS NOT NULL)
      OR (type <> 'group_repo' AND group_key IS NULL))
);
CREATE UNIQUE INDEX ux_ref_bindings
  ON ref_bindings (repo_key, COALESCE(group_key,''), ref_id);
```

- **没有单独的 `id` 主键**，业务键是唯一索引 `ux_ref_bindings (repo_key, COALESCE(group_key,''), ref_id)`；`COALESCE` 是必须的，否则 `group_key IS NULL` 时唯一性失效。
- `type` 三个取值与键组合：

| type | `repo_key` | `group_key` | 宿主语义 | 典型 rel |
|---|---|---|---|---|
| `repo` | 仓库 key（必填） | 必须为空 | 单个仓库自身 | `repo/<key>.md` |
| `group` | **组自身的 key**（必填） | 必须为空 | 项目组自身 | `board/<slug>.md` |
| `group_repo` | 组内成员仓库 key | 组 key（必须非空） | 「组 + 该组内某仓库」这一对 | `group/<slug>/<repoKey>.md` |

- **同一篇 ref 可以绑多处**：唯一键含 `repo_key`（和 `group_key`），所以同一 `ref_id` 可以出现在仓库 A、仓库 B、以及某个组的成员描述里，只是不能在同一宿主上重复。在库副本上实测：给同一 ref 追加第二个宿主 → 成功；同宿主同 type 再插一次 → `UNIQUE constraint failed: index 'ux_ref_bindings'`；给非 `group_repo` 行填 `group_key` → `CHECK constraint failed`。
- **当前活库里没有多处绑定的实例**：`ref_bindings` 共 67 行（`repo` 44 / `group_repo` 19 / `group` 4），按 `ref_id` 分组后 `COUNT(*) > 1` 的为 **0**，跨 type 的也为 **0**。即约束允许、数据未用。
- 唯一的写入方是 `rebuildRefIndex`（[repo/refs.js](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/repo/refs.js#L117-L165)），只在 `repo bind-topics --apply` 里被调用。
- `group/<slug>/<repoKey>.md` **就是 `group_repo` 这一层**，不是第四个单元；它的宿主是「组 + 成员仓库」这一对，不是仓库单独，也不是组单独。
- 另有一条独立通道：`repos.ext.ext_doc`（`docs bind` 换绑）、`ext_doc_links`（`docs link` 补篇）。它和 `ref_bindings` 不同步，例如 `ext_doc` 指向 `repo/<key>/glossary.md` 时不会产生 `ref_bindings` 行，refs 里就是 `orphan`（当前 nx-kv 即此状态）。

### 3.2 参考仓库（`repos.type='ref'`）：绑定单元只有两层

| 单元 | 存放位置 | 写入命令 | 说明 |
|---|---|---|---|
| 组级 | `group_refs(group_key, ref_key, note, position)`，`PK(group_key, ref_key)` | `repo bind <ref> --board <组id>` | v4 起；组内所有成员共享 |
| 仓库级 | `repos.ext.ext_linked[]`（JSON） | `repo bind <ref> --repo <仓库key>` | v3 遗留，代码仍可写可读 |

- **没有第三层**，也**没有「仓库组 / repogroup」实体**。「仓库组」是历史叫法，等于现在的**项目组 = `board` = `repos.type='group'` 的那行**；成员关系在 `repo_group_members(group_key, repo_key)`。
- **没有继承、覆盖、排除**：v4 明确“组内所有仓库共享，没有继承/覆盖/排除语义”，一个组 ↔ 多个参考、一个参考 ↔ 多个组，见 [v4.sql](file:///d:/a_js/js_proj/nx-kv/src/core/db/migrations/v4.sql#L1-L26)。
- **“不再有仓库级”只对可迁移数据成立**：v4 把历史 `ext_linked` 搬到 `group_refs`，但**无归属组的仓库绑定保留在 ext 里**（不静默丢弃），且 `repo bind --repo`、`repo ref of` 的 `direct[]` 仍在工作（[ref.js](file:///d:/a_js/js_proj/nx-kv/src/modules/repos/ref.js#L216-L280)）。所以当前实现是两类并存，`repo ref check` 会报“未迁移”的仓库级绑定。
- 这套表与 `ref_bindings` **没有任何外键关系**：`group_refs.ref_key` 指向 `repos.key`（参考仓库），`ref_bindings.ref_id` 指向 `refs.id`（文档索引行）。

## 4. 关联设计

### 4.1 表

| 表 | 主键 | 外键 | 谁写 | 什么时候写 |
|---|---|---|---|---|
| `refs` | `id` | — | `ensureDocRef`、`rebuildRefIndex`、导入 | 写文档（固定 `orphan`）、`repo bind-topics --apply`、bootstrap 导入 |
| `ref_bindings` | 唯一 `(repo_key, COALESCE(group_key,''), ref_id)` | `ref_id→refs.id`、`repo_key→repos.key`、`group_key→repos.key`（仅 `group_repo` 非空） | `rebuildRefIndex` / `putBinding` | 只在 `repo bind-topics --apply` 全树重建时 |
| `ref_attach` | `(ref_id, attachment_id)` | `ref_id→refs.id`、`attachment_id→attachments.id` | `syncRefAttachments` | 写文档、重建索引时解析正文里的附件引用 |
| `attachments` | `id` | — | 附件上传/导入 | 上传、导入任务附件/文档图片 |
| `task_attach` | `(task_id, attachment_id)` | `task_id→tasks.id`、`attachment_id→attachments.id` | 任务工具 | 任务创建/编辑带附件 |
| `group_refs` | `(group_key, ref_key)` | 两列都→`repos.key` | `replaceGroupRefs` | `repo bind <ref> --board` / `--remove`（store 落库） |
| `repos` | `key`（业务身份） | — | 仓库 CRUD / 导入 | 登记、改 key/remote、类型切换 |
| `repo_group_members` | `(group_key, repo_key)` | →`repos.key` | 组成员维护 | 加入/移出项目组 |

### 4.2 关系图

```text
                        repos(key, type=repo|group, ext JSON)
                         │ key                 │ key
        ┌────────────────┼─────────────────────┼──────────────────────┐
        │                │                     │                      │
  ext.ext_linked     group_refs          repo_group_members      ref_bindings
  (仓库级参考)     (组级参考, v4)         (组成员)         (repo_key/group_key/ref_id)
        │                │                     │                      │
        ▼                ▼                     ▼                      ▼
   [ref 仓库行]     [ref 仓库行]          [仓库行]                 refs(id, locator, state)
                                                                     │
                                                       ┌─────────────┴─────────────┐
                                                       ▼                           ▼
                                                   ref_attach                 (文件系统)
                                                  (ref↔附件)              docsRoot()/locator
                                                       │
                                                       ▼
                                                  attachments(id, local_path/url, hash…)
                                                       ▲
                                                       │
                                                   task_attach (task↔附件)
```

注意：`group_refs.ref_key` 和 `ref_bindings.ref_id` 名字都像 “ref”，但前者指向**参考仓库**（`repos.key`），后者指向**文档索引行**（`refs.id`）。两张表互不引用。

## 5. 当前真实状况（只读快照实测）

| 指标 | 数值 |
|---|---:|
| docs 树 `.md` 文件数 | 31 |
| `refs` 总行数 | 133 |
| `refs.state=''`（已绑定） | 67 |
| `refs.state='orphan'` | 66 |
| locator 前缀分布 | `repo/` 93、`group/` 30、`board/` 9、根级自由文档 1 |
| `ref_bindings` 总数 | 67（repo 44 / group 4 / group_repo 19） |
| `group_refs`（参考仓库→组） | 23 |
| `repos.ext.ext_linked`（仓库级参考） | 20 条 |
| 仓库行 | `type='repo'` 45（dev 15 / ref 29 / 哨兵 1）；`type='group'` 4 |
| 组成员关系 | 19 |
| attachments / ref_attach / task_attach | 74 / 0 / 87 |
| **DB 有、盘上没有**（自有 rel） | **102 行** |
| **盘上有、DB 没有** | 0 |

结论：

- 盘上 31 个文件**全部**有 refs 行，不存在“漏登记”的现存文件。
- 反向差异很大：133 行里 102 行指向不存在的文件。包含测试残留（如 `repo/d/temp/nx-kv-ref-*`）、已删/改名的历史文档，以及从未落盘的约定路径。**这是当前最主要的脏数据形态**。
- `ref_attach` 为 0，说明文档正文里没有可解析的附件引用（或从未同步过）。
- **归位动作主要是清 `refs.state`，不是补绑定行**：`repo bind-topics --apply` 后核对 6 篇新入库文档，其中 5 条的 `ref_bindings.created_at` 仍是 `2026-11-06`（bootstrap 导入时就已建好，与文件是否存在无关），只有 `fr` 那条是本次新增。也就是说绑定行可以早于文件落盘存在，索引与盘上事实此前是脱钩的。
- **`repo bind-topics --apply` 不会把 glossary 归位**：主篇绑定走 `repos.ext.ext_doc` 通道（`docs bind` / `docs add` 直接写 ext），而 `rebuildRefIndex` 只按约定路径 `repo/<key>/index.md` → `repo/<key>.md` 匹配；`repo/<key>/glossary.md` 不在其中，所以它继续停在 `state='orphan'`、无 `ref_bindings` 行。

## 6. 已知缺口

| 缺口 | 影响 |
|---|---|
| 裸放 md 不入库 | 直接把 `.md` 放进 `~/.nx-kv/docs` 不会产生 refs 行，面板看不到、孤儿统计也不认；只能靠 `repo bind-topics --apply` 或 bootstrap 导入 |
| 写入只 `ensure` 不绑定 | `ensureDocRef` 固定写 `state='orphan'`；正常 `docs add/set` 写出来的文档永远显示“孤儿”，必须整树重建才能归位 |
| 没有对账 / GC | 文件删除或改名后 refs 行留在库里（当前 106 行 DB-only），没有任何命令按盘上事实清理或反向补登 |
| `repo bind-topics --apply` 语义错位 | 名义是“绑队列”，实际顺带做全树 refs/ref_bindings 重建，且扫描范围不受 `--repo` 限制 → 一次局部操作会改动全局索引 |
| 行数门禁与登记表成对生效 | `scripts/check-lines.mjs` 的口径（601-800 是否必须登记）与 `line-lint-registry.json` 的内容必须作为一个整体合并：只取远端脚本配本地空表、或本地脚本配远端登记表，都会误报「过期登记」。属于配置耦合问题，不是任一侧的 bug |
