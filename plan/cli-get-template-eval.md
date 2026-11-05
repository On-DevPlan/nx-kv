# 评估：CLI / get 的交付提示词与模板字符串封装（任务 #62）

> 评估对象：当前 `nx-kv` 的 CLI 领取链路（`localtask get` / `localtask wait`）与
> **模板字符串机制**（`core/instruction-template.js`）。
> 结论先行：**机制齐了，编排没模板化**——「原始提示词 + 组关键路径」这段封装仍是
> 硬编码的字符串拼装，没法在面板里看见、也没法被外部参数驱动。本轮（#62）把这段
> 改成模板 + 占位符，并给领取引擎开了**平面扩展**（`--param k=v`）。

## 1 · 现状评估

### 1.1 CLI 领取链路（`localtask get` / `wait`）

| 环节 | 现状 | 评价 |
| --- | --- | --- |
| 取数 | `consumeFirstPending`（D-first，跳过被依赖/闸门挡住的 pending） | ✅ 稳：队列语义清楚，闸门与依赖都在内核判定 |
| 交付组装 | `tasktool/wait.js` 的 `buildTaskDelivery` | ⚠️ 组上下文那段是**硬编码拼装**（见 1.3） |
| 收尾指令 | `settings.taskSuffix`（多条）→ `core/instruction-template.js` 渲染 | ✅ 已经是模板：占位符 + 段落，单遍渲染不二次扫描 |
| ack 提示词 | `settings.ackPrompt`（多条）→ 同一套渲染器 | ✅ 与收尾指令同口径 |
| 时间目标 | `settings` 任务级 / 目录级 goal，`{{goal.*}}` 占位符 + check 指令 | ✅ 门禁在 `completeTask`，到点才放行 |
| 附件 | 正文 `![名](fileId)` → 交付里带本地绝对路径 | ✅ fail-open，标注失败不拖垮领取 |
| 外部参数 | ❌ **没有**：领取时无法往 ctx 里塞任何外部值 | 本轮补上（`--param`） |

### 1.2 模板字符串机制（`core/instruction-template.js`）

已有的能力：

- 占位符 `{{goal.name}} {{task.text}} {{source}} …`：按 `.` 分段走 ctx，缺失一律空串；
- 段落 `{{#goal}}…{{/goal}}`、`{{#task}}…{{/task}}`：ctx 缺失整段丢弃；
- 两条硬保证：**单遍渲染**（插入值不再扫描，正文里的 `{{…}}` 逐字原样）与
  **不折叠空白**（段落标记独占一行时连换行一起消费）。

缺口（与本任务直接相关的三条）：

1. **段落只认 `goal` / `task` 两个名字**——组上下文需要 `{{#group}}` / `{{#repo}}`
   这类按数据有无取舍的段落。已推广为**任意段落名**，并保持向后兼容：
   `goal` / `task` 缺失即丢弃；其他名字在 ctx 里**显式给了键**才按值取舍
   （给 `null` 即丢弃），没给这个键仍按未知标记处理（内容保留）。
2. **模板只服务「收尾指令」与「ack 提示词」两处**——交付给 agent 的那段
   「组 / 项目关键路径」不在模板体系内，因此**面板上看不见、用户改不了**。
3. **领取引擎没有外部参数入口**——ctx 的键全部是内建的，agent / 调用方无法按场景
   注入额外信息（例如「本轮按 lane=payment 走」）。

### 1.3 组上下文那段（改造前）

`tasktool/groupctx.js` 的 `renderGroupContext` 直接拼字符串：

```
〔项目介绍 · X〕（路径）：
正文
〔项目组上下文 · Y〕
组定位：…
组介绍（路径）：
正文
本项目在组里的位置：…
组内成员：
  - …
组绑定参考文件（可直接读取）：
  - …
```

问题：

- **看不见、改不了**——措辞写死在代码里，面板没有入口；
- **没有占位符**——外部参数进不来；
- **单项目 / 多项目、组 / 无组** 的分支散在 `if` 里，模板化之后交给段落取舍即可。

## 2 · 本轮的改造（设计）

### 2.1 交付上下文模板（新增 `tasktool/delivery-template.js`）

- 默认模板 `DEFAULT_DELIVERY_TEMPLATE` **逐字复现**改造前的输出口径（既有单测钉死）；
- 模板存在设置里：`settings.deliveryTemplate`
  （CLI：`localtask config --delivery-template "…"`，面板：设置 →「提示词 / 模板」→
  「交付上下文」一栏，含**占位符清单**）；
- ctx 形状（数据与措辞分离——ctx 只给数据，措辞归模板）：

  | 占位符 | 含义 |
  | --- | --- |
  | `{{task.text}}` / `{{task.id}}` | 原始提示词（正文逐字） |
  | `{{repo.name}} {{repo.intro}} {{repo.introPath}} {{repo.docs}}` | 项目介绍 + 补充文档路径 |
  | `{{group.name}} {{group.desc}} {{group.intro}} {{group.introPath}} {{group.note}}` | 组信息 |
  | `{{group.peers}} {{group.docs}}` | 组内成员 / 组绑定参考文件 |
  | `{{source}} {{summary}} {{cwd}} {{name}} {{goal.*}}` | 内建字段 |
  | `{{params.k}}` 与顶层 `{{k}}` | **外部参数（平面扩展）** |
  | 段落 `{{#repo}}` `{{#group}}` `{{#groupPeers}}` `{{#groupDocs}}` | ctx 里没这个键就整段不出现 |

- 组 / 项目的描述本身就是本地 markdown，所以「关键路径」给的是**磁盘真实路径**，
  agent 拿到就能读盘——这一点在模板化之后仍然成立。

### 2.2 平面扩展（`--param k=v`）

```
nx-kv localtask wait --cwd "<dir>" --param lane=payment --param retry=2
```

- 参数进 ctx：**顶层平铺**（`{{lane}}`）**同时**归拢在 `{{params.*}}`；
- 内建同名键**不被覆盖**（否则一条 `--param task=…` 就能把任务正文顶掉）；
- 解析口径在 `tasktool/params.js`：`k=v` 可重复、可逗号分隔；无 `=` 的项忽略。

### 2.3 面板可见

设置面板「提示词 / 模板」新增「交付上下文」一栏：多行编辑 + 保存 / 恢复默认 +
**占位符清单**（不靠记忆）。保存走 `PATCH /api/localtasks/setting` 的
`deliveryTemplate` 字段。

## 3 · 遗留与建议

- **多组**：默认模板渲染**第一个组**（`{{group.*}}`），其余组在 `{{groups}}` 里以
  概览形式给出。要逐组展开，模板作者可以自己写 `{{groups.0.name}}` 这类路径。
- **模板转义**：仍不支持字面 `{{`（与收尾指令同一限制）——模板正文无法表达字面 `{{`。
- **预览**：面板只给了占位符清单，还没做「用当前任务试渲染」的预览；下一步可以做。
- **CLI 侧**：`nx-kv localtask get` 与 `wait` 的参数形态一致（都是「取一条任务 +
  交付」），差别只在阻塞与否——本轮把 `--param` 两边都接上了，形态一致。
