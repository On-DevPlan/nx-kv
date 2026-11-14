# 2026-11-14 · 附件新增 folder（本地文件夹路径指针）

- date: 2026-11-14
- status: 已实施（#127）
- decision: `attachments.kind` 增加第六个值 `folder`。它与 mdfile 同属**外部路径指针**：只登记一个规范化绝对路径 + 展示名，目录内容不入库、不复制、不打包；交付时把路径交给 agent，由它按需列目录 / 读文件。
- tables: attachments（重建，仅扩 `kind` 的 CHECK；新增 folder 路径部分唯一索引）
- drops: attachments, _v10_task_attach, _v10_ref_attach
  - 说明：attachments 是 12-step 重建；两个 `_v10_*` 是关系表 TEMP 快照，回填后立即删除。
- producers: `localtask attach --folder <目录>`、`docs attach --folder <目录>`（同源登记函数）
- consumers: 交付模板 `attach.list[].folder.*`、附件清单渲染、设置面板模板变量表
- migration: `src/core/db/migrations/v10.sql`（9 → 10）

## 1. 为什么是独立 kind 而不是「file 指向目录」

`file` 语义是「本机附件仓里的一份字节」，有 size / hash / local_path / 云端同步；
文件夹没有字节，也不该被当成需同步的文件。混用会让 `file.exists` / `needsSync`
这些既有变量给出错误信号。独立 kind 后：

- `folder = { absPath, exists, missing, readCmd }` 是模板里的专属子对象；
- `kindLabel = '文件夹'`，清单与提示词都能显式区分；
- 路径大小写不敏感唯一索引防止同一目录登记多行。

## 2. 提示词变量（用户明确要求同步）

`DEFAULT_ATTACH_TEMPLATE` 的清单行增加 `{{#if folder}}{{folder.absPath}}…{{/if}}` 分支；
设置面板的模板变量表新增 `folder` / `folder.absPath` / `folder.exists` /
`folder.readCmd` 等条目；`usage` 给出「先列目录再读关键文件」的取用说明。

## 3. 不变式

- 迁移前后 `attachments` 行数、`task_attach` / `ref_attach` 行数完全一致；
- 原有 5 个索引原样重建，新增 `ux_attachments_folder_path`；
- 旧库（v9）启动时自动 9 → 10 升级，升级前按既有管线备份。
