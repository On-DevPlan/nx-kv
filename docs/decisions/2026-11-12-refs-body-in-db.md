# 2026-11-12 · refs 正文入库与 md 本地文件附件（存储版本 5/6 · 分批实施中）

- date: 2026-11-12
- status: 已批准 · 分批实施：第一批（mdfile）落 v5；第二批（ref 正文入库）落 v6
  - 拆分原因：迁移快照不可变（`src/core/db/migrations` 只增不改）。第一批只改
    `attachments`（v5）；`ref_bodies` / `refs.rel` 等 schema 改动必须在第二批单独落 v6，
    不能回写已发布的 v5。
- decision: `refs` 从「文档索引」升级为「文档本体」：正文进 `ref_bodies`，`refs` 只保留身份与元数据；`refs` 不再持有文件系统路径，`rel` 改为逻辑命名；外部 md 文件由**新增的独立 `attachments(kind='mdfile')`** 承载（不复用 `kind='file'` + MIME 判定），按路径按需加载、默认不复制。
- tables: refs（改，v6）、ref_bodies（新，v6）、ref_bindings（不变）、ref_attach（改 CHECK，v6）、attachments（重建以扩 kind/storage CHECK + 新增列，v5 已落地）
- drops: attachments, _v5_task_attach, _v5_ref_attach, ref_attach, _v6_ref_attach （attachments 是 12-step 重建；两个 _v5_* 是 v5 关系表快照临时表，回填后立即删除；ref_attach 在 v6 为扩 role CHECK 按快照重建，_v6_ref_attach 是它的 TEMP 快照）
- producers: `modules/docs/service.ts`（add/set/remove）、v5 迁移脚本、`core/attachmentdb.ts`（mdfile 登记与解析）
- consumers: `modules/docs/{store,render,service}.ts`、`modules/repos/repo/rows.ts`（desc 摘要）、面板文档编辑器、`repo knowledge` / `board get`
- 依据现状（2026-11-12 只读实测）: `refs` 133 行；`state=''` 67 / `orphan` 66；docs 树 31 个 `.md`；DB 有盘上没有 102 行；盘上有 DB 没有 0；`ref_bindings` 67 行（repo 44 / group_repo 19 / group 4）；`ref_attach` 0 行。

## 1. 结论

| # | 结论 | 说明 |
|---|---|---|
| C1 | 正文独立成表 `ref_bodies`，1:1 挂 `refs.id` | 列表/绑定查询不带正文；正文更新只动一张窄表，`refs` 的 `updated_at` 不因正文变化而抖动 |
| C2 | `refs` 不再存路径；`rel` 升为逻辑标识 | `rel` 仍沿用现有形态（`repo/<key>.md` 等），但语义是「命名空间内的名字」，不保证磁盘上存在同名文件 |
| C3 | `refs.id` 保持 `ref_<sha1(rel)>`，历史行不改 id | 现有 133 行的 id 全部保留；重命名是否允许改 id，见 O1（待定） |
| C4 | `locator` 冻结为历史列 | 不删、不参与唯一性、不再写入新值；作为旧路径取证与迁移核对用 |
| C5 | 外部 md 文件用**独立** `kind='mdfile'`，不改用 `kind='file'` + MIME 判定 | `mdfile` = 「路径指针 + 内容指纹 + 外部存储」，与 `file`（字节已入库）、`ref`（库内正文）三分；web 端按 `kind` 分支直接走 md 渲染 |
| C6 | `docs add/set/get/remove` 命令形态不变 | 变的是实现：正文不再落盘到 `docsRoot()`；`--body-file` 保留为「从文件读入参」的输入通道 |
| C7 | `ext.ext_doc` 通道本轮不动，但必须在 v5 一起换指向 | 它存的是 `{kind:'rel'|'path', value}`；路径语义消失后，`path:` 形态只能指向 mdfile，见 O4 |

## 2. 新 schema（v5）草案

### 2.1 `refs`：身份 + 元数据，不含正文、不含路径

```sql
-- 新增列（SQLite 可 ALTER ADD COLUMN，无需重建）
ALTER TABLE refs ADD COLUMN rel TEXT NOT NULL DEFAULT '';        -- 逻辑命名，唯一
ALTER TABLE refs ADD COLUMN origin TEXT NOT NULL DEFAULT 'own';  -- own | import | external
ALTER TABLE refs ADD COLUMN body_bytes INTEGER NOT NULL DEFAULT 0;

-- locator 保留为历史列：不再写、不再查。注释改为「v4 及以前：docs 树相对路径 / 外部绝对路径」
CREATE UNIQUE INDEX ux_refs_rel ON refs (rel) WHERE rel <> '' AND deleted_at IS NULL;
```

| 列 | 语义 | 与现状差异 |
|---|---|---|
| `id` | `ref_<sha1(rel)>`（新行）；历史行沿用原值 | 不变 |
| `rel` | 逻辑名：`repo/<key>.md`、`board/<slug>.md`、`group/<slug>/<repoKey>.md` | 原来等于物理相对路径，现在只是名字 |
| `locator` | **冻结**，仅历史取证 | 停写；不再作为 `docs get` 的解析入口 |
| `type` | 收窄为 `md` | v1 注释里的 `dir/image/file/path/url` 迁往 `attachments` |
| `origin` | `own`（CLI/面板写入）、`import`（批量导入）、`external`（来自 mdfile 的镜像） | 新增 |
| `body_bytes` | 正文 UTF-8 字节数（列表页显示用，避免读正文） | 新增 |

### 2.2 `ref_bodies`：正文唯一真相

```sql
CREATE TABLE ref_bodies (
  ref_id     TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  body_bytes INTEGER NOT NULL CHECK (body_bytes >= 0),
  body_hash  TEXT    NOT NULL DEFAULT '',   -- sha256(body)，用于导入去重与多机冲突检测
  updated_at INTEGER NOT NULL
);
```

- 1:1，**没有 `deleted_at`**：生命周期完全跟随 `refs`（CASCADE）。
- 不放 `refs` 同表的原因：`refs` 是所有列表/绑定的驱动表，正文是可变大字段；分表后 `SELECT * FROM refs` 不再拖着几十 KB 正文（当前 31 篇里 glossary 单篇 32 KB）。
- 备选：正文直接放 `refs.body`。否决理由见 §9.1。

### 2.3 关系表：不变，只调整 `ref_attach.role`

| 表 | v5 是否改 | 说明 |
|---|---|---|
| `ref_bindings` | 不改 | 三层 `repo/group/group_repo`、唯一键 `(repo_key, COALESCE(group_key,''), ref_id)` 全部保持；它绑的是 `refs.id`，与正文/路径无关 |
| `ref_attach` | CHECK 增 `'source'` | 新增 `role='source'`：这条 ref 的正文是从某个 `mdfile` 附件同步来的（`external` 来源） |
| `attachments` | 见 2.4 | |
| `group_refs` / `repos.ext.ext_linked` | 不改 | 参考仓库的两层绑定与文档无关 |

### 2.4 `attachments`：新增 `kind='mdfile'`

```sql
-- kind / storage 的 CHECK 必须重建表（SQLite 不能 ALTER CHECK），12-step:
--   PRAGMA foreign_keys=OFF → 建 attachments_new → 复制 → DROP → RENAME → 重建索引 → foreign_key_check
CREATE TABLE attachments_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('file','url','task','ref','mdfile')),
  name          TEXT NOT NULL DEFAULT '',
  local_path    TEXT NOT NULL DEFAULT '',   -- mdfile: 外部文件绝对路径；file: 本机附件仓副本
  url           TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  hash          TEXT NOT NULL DEFAULT '',   -- mdfile: sha256(文件内容)，用于失效/漂移检测
  storage       TEXT NOT NULL DEFAULT '' CHECK (storage IN ('','local','cloud','external')),
  group_id      INTEGER NOT NULL DEFAULT 0,
  target_kind   TEXT NOT NULL DEFAULT '',
  target_key    TEXT NOT NULL DEFAULT '',
  target_seq    INTEGER,
  dedupe_key    TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}',
  -- 新增（mdfile 专用，其他 kind 留空/0）
  abs_path      TEXT NOT NULL DEFAULT '',   -- 规范化后的绝对路径（唯一性基础）
  anchor_dir    TEXT NOT NULL DEFAULT '',   -- 相对链接的解析锚点 = 文件所在目录
  missing_at    INTEGER,                    -- 上次确认文件不存在的时间
  last_seen_at  INTEGER,
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_attachments_mdfile_path
  ON attachments (abs_path COLLATE NOCASE)
  WHERE kind = 'mdfile' AND deleted_at IS NULL;
```

`mdfile` 的 id 规则见 §5.2（`att_mdfile_<sha1(normalized_abs_path)>`），与 `file/url/task/ref` 共用 `att_<kind>_<hash>` 命名族。

`mdfile` 的加载语义（建议值，O5/O7/O8 待定细节）：

| 场景 | 行为 |
|---|---|
| 读取 | 按 `abs_path` 现读，读后核对 `hash`；不一致 → 返回正文 + `stale: true`，不自动改库 |
| 文件不存在 | 置 `missing_at`；正文不可读时返回空正文 + `missing: true`，**不软删行** |
| 相对链接 | 以 `anchor_dir` 为基准解析（不是 `docsRoot()`） |
| 是否复制 | 默认**不复制**（`storage='external'`）；`docs import <path> --rel <rel>` 才把正文复制进 `ref_bodies` |
| 与 ref 的关系 | `ref_attach(ref_id, attachment_id, role='source')`；一个 ref 最多一个 `source`（应用层约束，暂不加部分唯一索引） |
| 删除 | 删行只删登记，**不删外部文件**；外部文件删除不影响 `attachments` 之外的任何字节 |

### 2.5 身份：为什么仍然用 `sha1(rel)`

| 方案 | 稳定键 | 优点 | 代价 |
|---|---|---|---|
| A（推荐） | `ref_<sha1(rel)>` | 与现有 133 行 id 完全兼容；同一逻辑名幂等；不需要回填 | 改名 = 换 id，绑定会跟着变成新 ref（需显式 rename 动作） |
| B | 随机 ULID / uuid | 改名不动 id | 历史 133 行要回填，`ext.ext_doc` 里所有 `rel:` 引用要改指；跨机器重建时无法推算 |
| C | `sha1(rel)` + 可改 `rel` | 兼得 | 需要 `ux_refs_rel` 之外再维护一张 `ref_aliases`，本轮复杂度不值 |

`rel` 的保留方式：`rel` 是**对外标识**（CLI 入参、面板路由、`ext_doc` 的 `rel:` 形态都用它），`id` 是**内部外键目标**。两者解耦后，`rel` 可加 `ux_refs_rel` 唯一约束，历史行的 `rel` 直接取原 `locator`。

## 3. 迁移路径（v5 一次性，先备份后执行）

前置：`VACUUM INTO 'nxkv.v4.bak.db'`；迁移脚本只读 docs 树，写入在单事务内完成；写盘动作全部取消。

| 类别 | 行数/文件数 | 处理 |
|---|---|---|
| 盘上有、DB 有（正常） | 31 文件 ↔ 31 行 | 读文件 → `INSERT INTO ref_bodies`；`refs.rel = locator`；`locator` 原值保留；`origin='import'`；`body_bytes/body_hash` 计算落库 |
| DB 有、盘上无 | 102 行 | 迁移时**不删**：标 `origin='import'` 且 `body_bytes=0`、无 `ref_bodies` 行；是否软删见 O2（待定）。先出清单 CSV，人工确认三类（测试残留 `repo/d/temp/*`、改名/删除历史、从未落盘的约定路径） |
| 盘上有、DB 无 | 0 行 | 无需处理；迁移后新增文件一律走 CLI，不再扫盘 |
| 外部绝对路径 locator 残留 | 未知（`locator` 含盘符的行） | 不迁正文；登记为 `mdfile` 附件并挂 `ref_attach(role='source')`，`refs.rel` 用 `external/<sha1(abs)>` 占位 |

迁移后校验：

```sql
SELECT COUNT(*) FROM refs r LEFT JOIN ref_bodies b ON b.ref_id = r.id
 WHERE r.deleted_at IS NULL AND b.ref_id IS NULL;          -- 期望 = 102（历史空壳）
SELECT SUM(body_bytes) FROM ref_bodies;                     -- 与 docs 树 31 文件字节总量比对
SELECT COUNT(*) FROM refs WHERE rel = '' AND deleted_at IS NULL;  -- 期望 0
```

`locator` 是否保留：**保留**（C4）。它是唯一能对「102 行历史空洞」做取证的东西，删掉后无法回答「这行当年指向哪个文件」。代价是 `refs` 多一列死数据，可接受。

## 4. CLI 形态

| 动作 | 命令（建议） | 与现状关系 |
|---|---|---|
| 新建 | `docs add <rel> --body <md>` / `--body-file <f>` / `-` | **不变**，只是正文入 `ref_bodies`，不再写盘 |
| 更新 | `docs set <rel> --body` / `--body-file` / `-` | **不变** |
| 读取 | `docs get <rel> --json` | **不变**；`--raw` 输出正文纯文本 |
| 删除 | `docs remove <rel>` | **不变**；软删 `refs`，`ref_bodies` 级联消失 |
| 导入本地文件 | `docs import < abs path > --rel <rel>`（新） | 复制正文入库，登记 `origin='import'`；原文件保持不动 |
| 导出 | `docs export <rel> --out <path>`（新） | 兼容层：把库内正文写回文件，供人阅读/入 git |
| 挂载外部 md | `docs link-file <rel> --path <abs>`（新） | 建 `attachments(kind='mdfile')` + `ref_attach(role='source')`，不复制正文 |
| 同步外部 md | `docs pull <rel>` / `docs push <rel>`（新，待定） | 文件 ↔ DB 双向同步，冲突按 `body_hash` 判定 |

取舍：

- **保留 `docs add/set/get/remove` 四个动词**，不新增 `ref *` 命令：现有脚本、面板 HTTP 契约（`POST/PATCH /api/docs/item`）全部复用，减少一次破坏性改名。
- **`--body-file` 保留**，定位改为「入参读取方式」而非「存储位置」。这是本次最容易被误读的点：它不再意味着「文档存在那个文件里」。
- **文件导入/导出保留为显式命令**（`import`/`export`），不做隐式双向同步。隐式同步会重新引入「两份真相」，与本次目标相反；需要时由人显式 pull/push。
- `docs seed` 保留：作为「一次性灌入内置文档」的入口，落库形态同 `add`。

## 5. 附件侧：单独新增 `kind='mdfile'`

**结论：新增独立 `kind`，不用 `kind='file'` + MIME 代替。** 三者是三种不同的东西：

| 维度 | `ref`（文档库条目） | `file`（二进制附件） | `mdfile`（本地 md 文件指针） |
|---|---|---|---|
| 字节在哪 | `ref_bodies.body`（v5 后） | 本机附件仓副本 / 云端缓存 | 用户磁盘原地，`storage='external'`，不入库 |
| 是否复制 | 本身就是库内正文 | 入库即复制 | 默认**不复制** |
| 身份 | `refs.id`（`ref_<sha1(rel)>`） | 正文里的 `fileId`，与 `attachments.id` 对齐 | `att_mdfile_<sha1(normalized_abs_path)>` |
| 可变性 | 由 CLI/面板编辑，版本在库 | 内容不变（换文件 = 新 fileId） | 文件在库外随时可变，靠 `hash` 检测漂移 |

### 5.1 `kind` 的 CHECK 怎么改（属于 v5 迁移）

`attachments.kind` 现在是 `CHECK (kind IN ('file','url','task','ref'))`。SQLite **不能 `ALTER TABLE ... DROP/ADD CONSTRAINT`**，改 CHECK 只有一条路：12-step 重建表。

```sql
PRAGMA foreign_keys = OFF;              -- 事务外
BEGIN;
CREATE TABLE attachments_new (
  ...
  kind    TEXT NOT NULL CHECK (kind IN ('file','url','task','ref','mdfile')),
  ...
  storage TEXT NOT NULL DEFAULT '' CHECK (storage IN ('','local','cloud','external')),
  ...
);
INSERT INTO attachments_new (id, kind, name, local_path, url, mime, size, hash, storage,
                             group_id, target_kind, target_key, target_seq, dedupe_key, meta,
                             abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at)
SELECT id, kind, name, local_path, url, mime, size, hash, storage,
       group_id, target_kind, target_key, target_seq, dedupe_key, meta,
       '', '', NULL, NULL, deleted_at, created_at, updated_at
  FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
-- 逐条重建 v2 的 3 个索引 + 新增 ux_attachments_mdfile_path
COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;               -- 必须为空
```

迁移注意：

- `task_attach` / `ref_attach` 的外键在 `DROP TABLE attachments` 时会悬空。**已实测**：
  `defer_foreign_keys` 只推迟校验、不阻止 `ON DELETE CASCADE`，直接重建会清空关系表。
  v5 的实现改为事务内 `CREATE TEMP TABLE` 快照两张关系表 → 重建 → 按显式列名回填 →
  DROP 快照；当前 `ref_attach` 为 0 行、`task_attach` 87 行，真实库副本迁移后逐行核对 87 条未丢。
- 新增列对历史行一律给默认值（`abs_path=''`），不参与 `ux_attachments_mdfile_path`（部分索引限定 `kind='mdfile'`）。

### 5.2 身份规则

沿用 `ids.ts` 的 `att_<kind>_<sha1(seed).slice(0,16)>` 公式：

```ts
// core/attachmentdb/ids.ts
export function mdfileAttachmentId(absPath?: unknown): string {
  const p = String(absPath ?? '').replace(/\\/g, '/');      // 与 refIdFor 同一套 POSIX 归一
  return 'att_mdfile_' + sha1(p).slice(0, 16);
}
```

| 项 | 取值 |
|---|---|
| 归一化 | 反斜杠 → `/`；`path.resolve` 展开 `..`；Windows 盘符统一小写（`c:/...`）；不做 `realpath`（保留符号链接语义，避免同一文件两个 id） |
| 去重 | 同一归一化路径 = 同一 id；`ux_attachments_mdfile_path` 兜底 |
| 改名/移动 | 路径变 = id 变（新附件行）；旧行按 `missing_at` 标记，不自动迁移关系 |

### 5.3 四个环节的分支

| 环节 | `ref` | `file` | `mdfile` |
|---|---|---|---|
| **正文解析**（`parseAttachmentRefs`） | `nxkv://ref/<ref_id>` → `{kind:'ref', role:'reference'}` | markdown 目标是 `fileId` → `{kind:'file', role:'inline'}` | `nxkv://mdfile/<att_id>` → `{kind:'mdfile', role:'inline'}`；**裸相对路径 `.md` 链接不解析**（存量行为不变） |
| **渲染** | 按 ref 正文 md 渲染；无正文时显示 `rel` | 图片走 `<img>`，其他走下载卡片 | **一律走 md 渲染**（不看 MIME）；`stale`/`missing` 时在顶部加提示条，正文降级为「源文件不可读」 |
| **导出** | 从 `ref_bodies` 取正文写入导出包 | 复制附件仓字节；`cloud` 未缓存则跳过并记 warning | 默认**不打包**（外部文件不属于本库）；`--with-external` 开关时按 `abs_path` 现读复制 |
| **交付上下文**（`repo knowledge` / `board get` / 任务领取） | 作为文档条目进上下文，带 `rel` 与摘要 | 只列名字与 id，不进正文 | 读文件后按 md 注入上下文，标注来源路径与 `stale/missing`；读失败则只列「外部 md（不可读）」 |

渲染分支的判定点只有一处：`attachments.kind`。web 端不得再用「扩展名/MIME 是否 `text/markdown`」去猜，否则 `file` 里存一个 `.md` 二进制附件会走错分支。

### 5.4 路径加载的边界（待定，需拍板）

| 编号 | 问题 | 选项 | 影响面 |
|---|---|---|---|
| O5 | 是否复制入库 | A 只做指针（默认）；B 提供 `--copy` 一次性导入为 `ref`；C 默认复制、指针为例外 | 用户对「笔记会不会被搬走」的预期；备份与多机同步 |
| O7 | 路径失效后的行为 | A 保留行 + `missing_at`，读时返回空（建议）；B 标记后自动软删；C 从 `abs_path` 向上找同名文件自愈 | 面板「文档凭空消失」的观感；自愈可能挂错文件 |
| O8 | 相对锚点 | A 固定为文件所在目录（`anchor_dir`）；B 允许每个附件配置根目录；C 用 md 文件内 front-matter 指定 | 相对图片/链接能否解析；跨目录移动后是否还正确 |
| O9 | 是否允许登记库内 `docsRoot()` 下的文件 | A 禁止（避免两套真相）；B 允许但标 `origin='legacy'` | 迁移期兼容 vs 语义干净 |

加载语义（默认值，O7/O8 定了再改）：

- 不复制（O5 选 A）。
- 读时校验 hash；漂移只告警，不静默覆盖 DB 正文。
- 文件消失时保留行并标 `missing_at`，让面板能显示「源文件已不在」，而不是文档凭空消失。
- 不自动监听文件系统（无 watcher）；`docs pull` 或面板刷新时才比对。

## 6. 风险与影响面

| 风险 | 影响 | 缓解 |
|---|---|---|
| 31 个现有文件一次性导入 | 导入失败会丢正文 | 先 `VACUUM INTO` 备份；导入后逐篇比对 sha256；失败即中止事务 |
| 102 行历史空洞 | 迁移后「空壳 ref」会让统计看起来仍很脏 | 先出清单人工确认；软删与否见 O2 |
| Obsidian 等外部绑定目录 | 现有 `externalClosure/resolveExternal` 按路径读文件；路径语义消失后这套闭包要么废弃、要么降级为「mdfile 的登记来源」 | 二选一，见 O3；本轮只登记不改实现 |
| 多机同步 | 库在 `~/.nx-kv`，正文不再有文件可供 git/网盘同步；换机器后正文丢失 | `docs export` 提供导出；DB 同步本身不在本轮范围 |
| 可读性/可编辑性下降 | 用户不能再直接用编辑器改 `~/.nx-kv/docs/**` | 保留 `docs export`；面板编辑器已有（走 `doc.update`） |
| `ext.ext_doc` 通道 | 它用 `rel:` / `path:` 指主篇，且与 `ref_bindings` 本来就不同步（nx-kv glossary 现为 `orphan`） | v5 把 `rel:` 解析切到 `refs.rel`；`path:` 仅允许指 mdfile；是否合并两条通道见 O4 |
| 面板/API 契约 | `doc.get` 返回里有 `abs`、`bytes` 来自文件系统 | 返回体需要改字段来源；旧字段保留为兼容（`abs` 置空） |

## 7. 这次不改

- 不改 `ref_bindings` 的三层结构与唯一键。
- 不改 `group_refs` / `repos.ext.ext_linked` 的参考仓库两层模型。
- 不改 `attachments` 现有 `file/url/task/ref` 四种 kind 的语义与 id 规则（**新增 `mdfile` 是例外**，见 §5）。
- 不改 `task_attach`。
- 不在本轮合并 `ext.ext_doc` 与 `ref_bindings`（只标注必须跟随 v5 调整解析目标）。
- 不做 `docsRoot()` 的删除，也不删除现有 31 个文件（迁移后仅停止作为真相）。
- 不改 CLI 命令名；`docs add/set/get/remove/seed` 保持既有拼写。

## 8. 待定事项（需你拍板）

| 编号 | 问题 | 选项 | 影响面 |
|---|---|---|---|
| O1 | 是否允许 `docs rename <old> <new>` | A 不做（改名 = 删+建，绑定与 `ref_attach` 不跟随）；B 做（`id` 随 `rel` 变，需级联重写 `ref_bindings/ref_attach/ext_doc`） | 能用性 vs 实现复杂度；B 需要一次全量重挂 |
| O2 | 102 行历史空洞如何处理 | A 保持现状（`body_bytes=0`，不删）；B 迁移时软删；C 直接物理删 | 孤儿统计、面板「孤儿文档」噪音、取证需求 |
| O3 | 外部绑定目录（Obsidian）的闭包还留不留 | A 废弃 `externalClosure`，一律转 mdfile；B 保留闭包但只作为 mdfile 登记的授权边界；C 保留并允许直接读（与 C2 冲突） | 安全边界（任意路径读取）与用户便利 |
| O4 | `ext.ext_doc` 与 `ref_bindings` 是否合并 | A 合并（单一真相，`ref_bindings` 增 `is_primary`）；B 保留双通道（现状，继续可能不一致） | 面板/`repo knowledge` 的主篇判定；合并需数据回填 |
| O5 | mdfile 是否提供「导入即复制」开关 | A 只做指针；B 提供 `--copy`；C 默认复制、指针为例外 | 用户对「我的笔记会不会被搬走」的预期 |
| O6 | 正文是否压缩/分块 | A 明文 TEXT；B zstd 压缩列；C 分块存外部对象 | 当前最大单篇 32 KB，A 足够；但会影响未来大文件上限 |
| O7 | mdfile 路径失效后的行为 | A 保留行 + `missing_at`（建议）；B 标记后软删；C 向上找同名文件自愈 | 面板观感；自愈可能挂错文件 |
| O8 | mdfile 相对链接锚点 | A 文件所在目录；B 每附件可配根目录；C md front-matter 指定 | 相对图片/链接能否解析、移动后是否还正确 |
| O9 | 是否允许把 `docsRoot()` 下的文件登记为 mdfile | A 禁止（避免两套真相）；B 允许并标 `origin='legacy'` | 迁移期兼容 vs 语义干净 |

## 9. 备选方案与否决理由

### 9.1 正文直接加列到 `refs.body`

否决：`refs` 是列表、绑定、孤儿查询的驱动表，`SELECT *` 会被大字段拖慢；正文更新会刷新 `refs.updated_at`，让「元数据变更」与「正文变更」混在一个时间戳里，绑定重建与审计都失去判据。与现有「`attachments` 与 `task_attach` 分离」的取舍一致。

### 9.2 保留文件为真相，DB 只存索引（现状）

否决（本次需求）：用户明确要求「正文进 DB，不再散在文件系统」，且现状已产生 102 行盘上不存在的历史空洞——路径作为真相无法自证。

### 9.3 只加 `kind='mdfile'`，refs 不动

否决：外部 md 与库内 md 会继续走两套正文来源，`refs` 语义不统一；且用户明确要求 refs 不再绑本地路径。

## 10. 落地顺序（供评审排期，不代表已批准）

1. v5 迁移脚本（`refs.rel/origin/body_bytes` + `ref_bodies` + `attachments` 重建），先在库副本跑通并比对 31 篇 sha256。
2. `docs add/set/get/remove` 切换正文来源（先写双份：DB + 文件，观察一轮后再停写文件）。
3. `docs import/export` 上线，作为文件兼容层。
4. `attachments(kind='mdfile')` 与 `docs link-file`。
5. `ext.ext_doc` 解析切换（按 O4 结论）。
6. 清理 `docsRoot()` 旧文件与 102 行空洞（按 O2 结论）。

## 11. 二轮评审确认（2026-11-12，v6 实施口径）

| # | 确认项 | 结论 |
|---|---|---|
| D1 | 102 行盘上无文件的 refs | 按 **O2-A** 保持空壳：不软删、不删行、`body_bytes=0`；先出 CSV 清单存档取证 |
| D2 | 外部绝对路径 locator | 文件仍在 → 登记 `attachments(kind='mdfile')` + `ref_attach(role='source')`；文件不在 → 只留空壳，不登记 |
| D3 | `meta.locator` | 保留为历史取证列（冻结，不写新值）；同时增补 `meta.rel`（逻辑名） |
| D4 | 迁移硬门禁 | 盘上每篇正文逐篇 `sha256` 落库后回读比对，任一不符 → 整步事务回滚 |
| D5 | O1 / O3 / O4 | 仍未定；v6 按「只切解析、不改语义」处理：不引入 rename、不废弃外部闭包、不合并 `ext_doc` |

**身份维持方案 A**：公式仍是 `ref_<sha1(...)>`，输入从 `locator` 换成 `rel`；存量 133 行 id 全部保留，不换 ULID。

### 11.1 v6 新增验收项（读路径必须可区分）

`legacy/<id>` 与 `external/<sha1>` 两类 `rel` 在任何读路径上都**不能看起来像正常文档**：

1. `docs list`：每行带 `relKind`（`normal | legacy | external | empty`）；没有正文的行显式标注「无正文」，不得渲染成空文件。
2. 文档页（知识聚合 / 面板文档编辑器）：同上，`legacy` / `external` / 无正文明示原因，不给「空白正文」。
3. 交付清单（`doc-inline` / `repo knowledge` 等）：无正文条目标注 `missing: true` + `reason`，不输出空串冒充正文。
4. `docs get`：对无正文 / `legacy` / `external` 返回 `missing` 语义并说明原因（哪一类、为什么没有正文），不返回空文档成功态。

### 11.2 v6 迁移计数基线（2026-11-12 实测）

| 项 | 数量 |
|---|---|
| 盘上 `.md`（docs 树） | 31 |
| `refs` 总行数 | 133 |
| 盘上无文件的 refs | 102（空壳，保留） |
| `ref_attach` 现有行 | 0 |
| `attachments` | 74 |
| `task_attach` | 87 |

迁移后期望：`ref_bodies` = 31 行（盘上每篇一条）；`refs.rel=''` 的活动行为 0；逐篇 sha256 与盘上文件一致。

## 12. DOCS_DIR 收口（2026-11-12，硬约束落地）

**约束原文**：`NX_KV_DOCS_DIR` 只是 mdfile 的默认附件目录，只能通过 attach 访问；严禁不经 attach 表直接读该目录下的文件。

### 12.1 六条落地

| # | 条款 | 落点 |
|---|---|---|
| C1 | 语义改名：`docsRoot()` → `mdfileDir()` / `mdfileDirFromEnv()`，注释不再叫「文档根」 | `src/core/paths.ts`、`src/modules/docs/paths.ts` |
| C2 | 文档正文只从 `ref_bodies` 读；`docs list/get`、`repo knowledge`、交付注入、面板文档页全部 DB 来源，删磁盘扫描分支 | `modules/docs/*`、`modules/repos/*`、`modules/tasktool/*`、面板文档页 |
| C3 | 唯一文件读入口收敛到 `readMdfile`；交付注入外部 md 也必须先经附件解析 | `core/attachmentdb/mdfile.ts`、`modules/tasktool/doc-inline.ts` |
| C4 | 加自动违规检查：扫 `src/**` 的 `NX_KV_DOCS_DIR\|docsRoot\|mdfileDirFromEnv`，只允许 paths / attachmentdb / db 三处 | `tests/unit/docs-dir-policy.test.mjs` |
| C5 | 31 个盘上文件导入 `ref_bodies` 后磁盘副本保留但不再读取，CSV 标注「已入库、盘上副本仅留档」 | `v6-data.ts`、`.tmp/refs-no-body.csv` |
| C6 | `docs add` / `docs set` 只写 DB 不写盘；`--body-file` 仍可读任意用户输入路径（不经过 mdfile 默认目录） | `modules/docs/store.ts` |

**环境变量名保留 `NX_KV_DOCS_DIR`**：只改函数语义，不动作废用户既有配置。

### 12.2 O9 反转

原 O9-A「文档树内禁止登记 mdfile」与新语义自相矛盾：默认目录本来就是 mdfile 的存放地。本轮一起删除：

1. `registerMdfile` 的「文档树内禁止登记」守卫；
2. `RegisterMdfileInput.docsRoot` 字段及其传递链；
3. smoke 的 O9 断言（`validateRelPath` 的路径守卫仍然保留，它防的是 `..` / 绝对路径，不是目录归属）。

### 12.3 外部绑定 md 不再自动内联

外部绝对路径 md 若未登记为 mdfile 附件，交付/注入**不读盘**，且必须显式说明：

- `docMissing = true`；
- `docMissingReason = '该文档未登记为附件，无法内联'`；
- `docRegisterCmd = 'nx-kv localtask attach --id <seq> --key <key> --mdfile "<abs>"'`。

不允许静默不出现正文（否则用户会误以为文档是空的）。单测 `attach-doc-inline` 断言这三项存在。

### 12.4 盘上副本处置

31 份盘上 `.md` 迁移入库后**只留档，不自动登记 mdfile**：迁移脚本不调用 `registerMdfile` 处理 docs 树内文件，磁盘副本不被读取、不被删除，仅供人工回溯。

### 12.5 违规检查的形状

`tests/unit/docs-dir-policy.test.mjs` 递归扫 `src/**/*.ts(x)`，命中下列 token 且文件不在白名单 → 失败：

- 白名单：`src/core/paths.ts`（定义处）、`src/core/attachmentdb/**`（唯一读入口）、`src/core/db/**`（迁移 / 索引重建）。
- token：`NX_KV_DOCS_DIR`、`docsRoot`、`mdfileDirFromEnv`。
- 注释里也不许出现（避免「文档根」语义以注释形式回流）。
