# 提示词模板系统

范围：`tasktool` 交付提示词的渲染链，以及设置页「提示词模板」。不涉及「任务模板」（那是 `templates` 表里的任务正文骨架）。

## 1. 引擎选型：Handlebars 4.7.10

选型理由（与 `src/core/instruction-template.js` 和 `docs/research/template-engine-choice.md` 一致）：

- **同步渲染**：`compile()` 产出的模板函数是纯同步的；`wait/get` 交付链不需要 async 渲染。
- **原生控制结构**：`{{#if}}` / `{{#unless}}` / `{{#each}}`（含 `{{else}}`、`{{@index}}`、`{{@first}}`），列表不需要自定义 helper。
- **可关 HTML 转义**：提示词是给 agent 的纯文本，`noEscape: true`，不会把 `&`、`<`、`"` 变成实体。
- **无额外运行时依赖**：`handlebars` 自身只带内部小包，ESM 直接可用；不需要模板编译器服务。
- **默认禁止原型链取值**，4.7 有持续维护与 CVE 跟进。
- **单遍渲染**：插入值（`task.text` / `goal.prompt`）只是数据，不会被再次解析；正文里的 `{{...}}` 逐字保留。

被排除的候选：

| 候选 | 排除原因 |
|---|---|
| LiquidJS | 空串按真值处理（`{{#if ""}}` 会通过）；块标签独占行时会在输出留空行，提示词里不可控 |
| Mustache | 无原型链保护，对象插值容易漏出 `[object Object]`；条件/循环能力弱 |
| Nunjucks | API 偏异步，需要包 Promise；包体更大，未纳入实测 |
| EJS | 「模板即 JS」，安全边界与可读性都差，不适合用户可编辑的提示词 |
| 自研解析器 | 需要手写词法/条件/循环/上下文，边界用例多，且此前版本没有原型链保护；已删除，不要复活 |

## 2. 模型：一份共享入参 + 纯字符串模板 + 薄编排

渲染链只有三层：

1. `tasktool/delivery-template.js` 的 `buildDeliveryCtx` 造**唯一一份 ctx**。
2. `shared/prompt-blocks.js` 提供区块定义（id/标签/输出顺序/内置模板）与归一化/迁移。
3. `tasktool/system-blocks.js` 的 `composeSystemBlocks` 按固定顺序取**每个区块当前生效的模板**渲染、包标签；全局追加模式在这里统一生效。**不生产预渲染正文，没有 block 对象中间层**。

共享 ctx 形状（所有区块共用，不存在「某模块自带变量域」）：

```text
{ task, repo, group, attach, goal, ext, getloop, source, summary, cwd, name, params }
```

- `task`：`{ id, text }`，`text` 是正文原文。
- `repo`：`{ name, key, intro, introPath, docs[], docCount }`，无项目介绍时为 `null`。
- `group`：`{ name, key, desc, intro, introPath, note, position, peers[], docs[], peerCount, docCount }`；空壳组（只有成员名单、全员无描述）会被过滤成 `null`。`groups` 是多组概览数组（`name/desc/path`）。
- `attach`：`{ count, list[], sync }`；`list` 元素含 `kindLabel/name/localPath/id/isImage/synced`。
  `sync` 是结构化对象（`dir/downloaded/skipped/failureCount`），未跑同步为 `null`。
- `goal`：时间目标字段，另有 `check`（任务级 check 指令）与 `statusLine`（队列级状态行）。
- `ext`：同主题待领取队列 `{ count, list[] }`（元素含 `id/title/topic`），队列空时为 `null`。
- `getloop`：项目级「持续 get」渲染后的 `{ text, waitMinutes }`，未开启为 `null`；指令模板自身也可用 `{{getloop.waitMinutes}}`。
- `params`：`--param k=v` 的外部参数；同时平铺到顶层（内建同名键不被覆盖）。

区块、标签与固定顺序（`BLOCK_DEFS`）：

| 顺序 | id | 标签 | 默认内容 |
|---|---|---|---|
| 1 | `context` | `<nx-kv.context>` | 项目介绍 + 补充文档 + 组定位/介绍/成员/参考文件 |
| 2 | `attachment` | `<nx-kv.attachment>` | 附件数量、清单、本地路径/同步详情 |
| 3 | `timecheck` | `<nx-kv.timecheck>` | 任务级 check 指令或队列级状态行 |
| 4 | `ext` | `<nx-kv.ext>` | 同主题待领取任务数量与标题；空队列整段省略 |
| 5 | `ack` | `<nx-kv.ack>` | 默认可见：完成后 `localtask done --summary`（完成指令与收尾要求的唯一出口） |
| 6 | `getloop` | `<nx-kv.getloop>` | 项目开启持续 get 时输出指令，含每轮阻塞分钟数 |

旧 `rule` 区块已删除：它不单独成块，`done` 指令与收尾要求统一由 `ack` 承载。

每个区块始终至少有一个**系统内置模板**：不可删除、不可编辑、可恢复；用户模板可新建/编辑/复制/删除，每个区块各自指定当前生效项，保存即生效。

`appendMode`：`xml`（默认，根标签 `<nx-kv>`）或 `plain`（正文按空行直拼，兼容旧行为）。没有可输出段落时 `instruction` 省略。

## 3. 可用语法（只有三种）

```handlebars
任务 {{task.id}}（{{source}}）当前目录 {{cwd}}
{{#if summary}}现状：{{summary}}{{/if}}

{{#if repo}}
〔项目介绍 · {{repo.name}}〕（{{repo.introPath}}）：
{{repo.intro}}
{{#if repo.docs}}
项目补充文档（可直接读取）：
{{#each repo.docs}}
  - {{path}}{{#if tag}}  [{{tag}}]{{/if}}
{{/each}}
{{/if}}
{{/if}}

{{#each group.peers}}
  - {{name}}：{{#if note}}{{note}}{{else}}（无组内描述）{{/if}}
{{/each}}
```

1. `{{var}}`：取值。
2. `{{#if x}}…{{else}}…{{/if}}`：条件；`x` 为假/空/缺失时走 `{{else}}`。
3. `{{#each list}}…{{/each}}`：循环；循环内直接用元素字段（`{{name}}`、`{{path}}`、`{{kindLabel}}`）。

约束：

- **列表一律结构化 + `{{#each}}`**；禁止在 service 里先拼成多行字符串再塞给模板。
- **旧语法已删除、不兼容**：`{{#repo}}…{{/repo}}` 等旧闸门（含 `blockHelperMissing` 覆盖）、旧纯文本占位符 `{{group.peers}}` 等、`{{attach.sync}}` / `{{attach.syncText}}` 旧别名、`{{block.content}}` 旧包装，一律不再支持。保存校验直接拒绝并提示改用 `{{#if}}` / `{{#each}}`；运行期遇到按坏模板回落该区块内置模板并记 `renderWarnings`。**不维护新旧两套语法，旧模板不保证可用。**
- 缺失路径按 Handlebars 默认渲染成空串；不要用 `strict: true`。
- 不要注册自定义 helper；不要使用 `{{#unless}}`、`{{@index}}`、`{{@first}}` 等额外语法，保持三种写法可预测。
- 单区块模板长度上限 `8000`（`MAX_BLOCK_TEMPLATE_LEN`）；每区块模板条数 / 名称长度按后端上限校验。

## 4. 设置模型与存储

**每个区块一份独立的模板列表**，各块按自己的列表与生效项工作。

- 六个区块：`context` / `attachment` / `timecheck` / `ext` / `ack` / `getloop`；每个区块的列表可新建、编辑、复制、删除，并指定该区块当前生效的那一个，保存即生效。
- 每个区块始终至少保留一个系统内置模板：内置不可删除、不可编辑，可「恢复内置」；用户模板删到只剩内置时区块仍按内置渲染。
- 所有区块共用 `buildDeliveryCtx` 的同一份 ctx；全局设置（`appendMode` 等）对所有区块整体生效。
- 存储、归一化、迁移与保存校验集中在 `src/modules/localtask/repo/settings.js` 与 `src/shared/prompt-blocks.js`；旧键（`lt.deliveryTemplate` / `lt.attachTemplate` / `lt.taskSuffix` / `lt.ackPrompt` / `lt.xmlBlocks` / 旧的整组模板键）只作为**迁移来源**，不再作为读写模型。
- 读取旧库时由迁移把旧键中**语法有效**的模板映射到各区块列表，并保证每块至少有一个内置模板；旧语法模板（`{{group.peers}}` 占位符、`{{#repo}}` 闸门等）不迁移、直接跳过——旧模板不保证可用。
- **rule 迁移**：旧的 `lt.taskSuffix`、整组模板里的 `rule`、`lt.xmlBlocks.rule`、以及已落盘 `blockTemplates.rule`，都会在首次读取时按空行并入 `ack` 当前生效模板（固定条目 `legacy-rule`），内容不丢；保存后 `lt.blockTemplates` 只写六个区块键，不再出现 `rule`。
- 持续 get：项目级模板先在共享 ctx 中渲染成 `getloop.text`，再由 `getloop` 区块输出；渲染失败同样记入 `renderWarnings`。
- 面板/CLI 读写与预览的具体 action/路由以 `localtask` 的 settings/preview action 为准（`node bin/cli.mjs routes --module localtask` 可直接核对），预览只读。

**UI 边界**：Web 设置页只承载「区块 → 模板列表 → 新建/编辑/复制/删除/启用/恢复内置」和全局追加模式。**引擎名称、语法讲解、变量字典不显示在设置页**，只写在 skill 与 `docs/` 里；不要因为方便又把它们加回 UI。

## 5. 两层校验与失败策略

| 层 | 触发 | 行为 |
|---|---|---|
| 保存时 | 保存任一区块模板 | `validateTemplate()` 用 `HB.precompile` 编译；语法错误**拒绝保存**，错误信息指出**区块 + 出错位置** |
| 运行期 | 领取/预览时仍遇到坏模板（旧数据、手改库） | 该块**回落该区块的系统内置模板**，告警写入 `renderWarnings`；**不阻断领取** |

正常入口进不来坏模板；运行期回落是兜底，不是静默出口。`renderWarnings` 必须出现在 CLI 返回载荷与预览 trace 中。

## 6. 代码地图

- 引擎：`src/core/instruction-template.js`
- 共享区块/默认模板/归一化：`src/shared/prompt-blocks.js`
- ctx 组装：`src/modules/tasktool/delivery-template.js`
- 薄编排 + 回落：`src/modules/tasktool/system-blocks.js`
- 真实交付接入：`src/modules/tasktool/wait.js`（`buildTaskDelivery`）
- 预览：`src/modules/tasktool/preview.js`、`src/modules/localtask/index.js` 的 `localtask.preview`
- 设置读写/迁移/保存校验：`src/modules/localtask/repo/settings.js`
- 设置页：`src/web/frontend/page/settings/{task-templates-section,prompt-templates-section}.jsx`
- 选型研究：`docs/research/template-engine-choice.md`

注意：模型版本记为 v5（每区块独立模板列表）。旧注释里的「v3 / v4」指同一套「共享 ctx + 字符串模板」的早期阶段；不要据此恢复任何旧结构或旧语法兼容。
