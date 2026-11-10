# #162 ref优化 —— 任务级文档绑定资源化（进原文 + desc）

## 需求解读（任务原文 → 工程口径）

任务原文三句话：

1. 「文档也进行资源化；一个 task 除了主文档应该支持自定义的文档进入原文，而不是简单的路径」
   → 任务级文档绑定（`localtask attach --ref`，kind=ref 附件）目前交付只给 路径+`docs get` 命令；
   要支持**交付时内联文档全文**，减少 agent 反复访问 nx-kv。
2. 「task 级别也支持绑定这个 topic 的单独 ref」
   → 绑定宿主已有 repo 级（`repo doc add`）/ 组级（`docs link`），缺的是任务级的能力补全
   （任务级绑定本身已存在，缺「进原文」与 desc 透出）。
3. 「每个 link 绑定都该包含 desc 字段，追踪渲染时补充出来，方便 agent 决定是否要真的访问这个 ref」
   → 任务级绑定的 desc（`--note`）**embed 路径会丢**（只写正文不落边）、且交付渲染**从不显示** note
   → 修落库 + 渲染。
   → repo/group 级 docLinks 的 note 已支持且 context 模板已渲染（`{{#if note}}  # {{note}}{{/if}}`）
   → 本次用测试固化，不重复建设。

## 方案

- 「进原文」的落库载体：`task_attach.role='doc'`（v2 保留语义「作为文档资料挂载」，当前无写入方，
  语义与「文档资料进原文」完全对口；**零 schema 迁移**）。
- CLI：`localtask attach --ref <doc> --inline` → 落 role='doc' 边（可叠加 --note / --no-embed）。
- 交付：`annotateTaskDelivery` 新增 `inlineDocs` 选项——role='doc' 的 ref 项读文档全文
  （自有 rel → docs 树；外部绝对路径 → 绑定闭包内；**只读不播种**），截断 20000 字；
  默认附件模板新增「文档原文」段 + 清单行透出 `{{note}}`。
- `linkAttachment` 同级更新：显式给 note 才更新（undefined 不动），正文同步不冲掉 desc。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/core/attachmentdb/relations.js` | linkAttachment 同级更新支持显式 note |
| `src/modules/tasktool/doc-inline.js` | 新增：读 ref 正文（只读）+ 内联标注 + 长度上限 |
| `src/modules/tasktool/attach-resource.js` | resourceOf 透出 note |
| `src/modules/tasktool/attach.js` | attachToTask `--inline`；embed 路径补写边带 note；annotate 加 inlineDocs |
| `src/modules/tasktool/attach-template.js` | ctxItemOf：note、ref.content/truncated、doc 角色 usage |
| `src/shared/prompt-blocks.js` | DEFAULT_ATTACH_TEMPLATE：清单行 note + 「文档原文」段 |
| `src/modules/tasktool/wait.js` | buildTaskDelivery 传 inlineDocs: true |
| `src/modules/localtask/action-attach.js` | --inline flag 声明 |
| `src/modules/localtask/action-render.js` | attachments 清单渲染 note / 进原文标记 |
| 测试 | attach-template / attach（--inline 落边、embed 落 note、正文同步不冲 note、内联全文渲染、外部闭包拒绝） |
| 文档 | README、docs/project&projectsCli.md、CHANGELOG.md；grep assets/ 是否需要同步 |

## 验收口径

1. `localtask attach --ref x --inline --note "说明"` → `localtask attachments` 显示 note + 进原文标记；
2. 真实交付（preview + 临时库 get）instruction 里：清单行带 desc、文档全文出现在「文档原文」段、
   超 2 万字截断并给读取命令；
3. 不带 --inline 的旧绑定行为逐字节不变（路径+命令，fail-open 纪律不破坏）；
4. `pnpm lint && pnpm test:unit && pnpm test:smoke && pnpm build` 全绿；无 schema 改动（不涉迁移）。
