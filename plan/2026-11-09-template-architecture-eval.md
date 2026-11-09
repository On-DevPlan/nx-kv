# 【任务模板改造】架构评估（任务 #123 · ack 返回评估）

> 任务原文要求「先思考架构合理性 ack 返回评估」——本文是完整版评估，
> `done` 总结是它的压缩版。实现待评估确认后进行（预期经 reopen 调整后开工）。

## 0. 现状盘点（评估的事实基础）

**存储**：`templates` 表（v1.sql:716）——id / category / name / body / vars_schema / vars /
is_default / enabled / sort_order / builtin。**没有任何 scope 列**：所有模板全局可见。
category 四类：`newtask`（用户面，新建页骨架）/ `delivery` / `enhance` / `context`
（后三个是引擎侧提示词组装钩子，非用户模板）。

**消费点**：
- 新建页：`use-templates.js` → `defaultBody()`（dir 页工具栏、group 页新建任务、dir/task 页）
- dir 页**已有模板下拉菜单**（`tplMenuItems`，dir/index.jsx:156——列出全部 newtask 模板 + 管理入口）
- 设置页 task-templates-section：编辑出厂骨架；templates 管理页（page/templates）

**关键前提（任务原文点 2）**：本机单操作者 = super admin，无用户/角色概念；
「可见性/权限」的 subject = **topic**（目录/组队列，稳定 topicKey）。

## 1. 逐条评估

### 1.1 「降格为普通内容资源 + role 标签」→ 方向对，v1 不做全量去类型

- 结构上模板**已经是**普通行数据（一张表、无硬编码类别分支消费），真正的痛点是
  **没有 scope**（全局可见、无处归属），不是「类型太硬」。
- 把 docs（磁盘文件）、tasks（带链语义的行）、templates 统一进一张 `resources` 表
  是大迁移，收益为零（没有第二种用户内容资源要共享同一套基础设施）。
  按 rule of three：等第二种资源真的出现再抽象。
- **结论**：保留 `templates` 表，加 scope 列；`role` 列等第二个内容种类落地时再引入。

### 1.2 「独立策略引擎动态判定」→ 采纳模型，拒绝引擎

- 本地单用户工具里，policy 判定退化为一个**纯函数**：给定 topic T，哪些模板可见（use）、
  哪些可编辑（edit）。没有 authN/Z、没有规则冲突仲裁、没有动态加载需求。
- 引入独立策略表 + 规则语言 + 求值器 = 净增一个概念（policy），却没减掉目标概念
  （硬编码分类）——违背任务自己的「降低概念复杂度」目标。
- **结论**：scope 列就是这台资源上的策略集；`can(template, action, topic)` 一个纯函数
  做解析。接口形状与策略引擎一致，将来多用户化了可以把 scope 行升级成策略表，
  调用方零改动。

### 1.3 「消除全局/项目硬编码分类」→ 对 newtask 成立，delivery/enhance/context 不动

- newtask 的全局性是真问题（任务要求 per-topic 可见性 + 跨项目共享）。
- delivery/enhance/context 是**引擎钩子**（提示词组装的阶段槽位），语义上不是
  「用户内容资源」，指令组装链路依赖它们按类目取行。把它们卷进去是為去类型而去类型。
- **结论**：改革范围 = newtask；其余三类保持系统内置（builtin、scope 恒 `*`）。

### 1.4 「实例化 = 角色转换 + 变量注入，原模板与实例解耦」→ 现状已满足

- newDraft 复制渲染后正文、模板原样不动——**这已经是既定行为**，零迁移风险。
  「角色转换 template→page」在本项目语境里就是「复制进某 topic 的队列」。

### 1.5 「组合与继承（引用和覆盖）」→ YAGNI，推迟

- 任务正文是短 Markdown 骨架；继承引入解析顺序/覆盖语义/环检测，复杂度实打实，
  需求还没有。将来若需要，`{{> template:id}}` 在实例化时单遍展开就够。
- **结论**：schema 注释里留一句「预留 include 语法」即可，不做实现。

### 1.6 UI（hover 圆角下拉 + 右下角新建）→ 可行且顺势

- dir 页已有模板下拉（tplMenuItems），改成「按当前 topic 过滤后的列表」是小改；
  group 页新建任务补同样的 hover 面板；面板底部加「为本 topic 新建模板…」
  （scope 预置该 topic，满足「默认对该 topic 可见」）。
- 设置页加 scope 编辑（chips：topic/组/项目/全局）。

## 2. 建议落地方案（评估确认后的实现稿）

**Schema（vN 迁移，全部带默认值 → 旧数据零行为变化）**：
```sql
ALTER TABLE templates ADD COLUMN scope TEXT NOT NULL DEFAULT '["*"]';
  -- JSON 数组，条目词表： "*" | "topic:<key>" | "repo:<key>" | "group:<key>"
  -- 解析：T 可见 ⇔ scope 含 "*" 或 T.key / T.repo_key / T.group_key 任一命中
ALTER TABLE templates ADD COLUMN origin_topic TEXT NOT NULL DEFAULT '';
  -- 创建时所在 topic（「新建默认对该 topic 可见」的落点 + 编辑归属展示）
```
builtin 模板 scope 恒 `["*"]`；settings 页（super admin）看全部。

**API**：
- `GET /api/templates?topic=<key>` → 该 topic 可见列表（带 effectivePerm: use/edit）；
  无参 = 全量（设置页用，向后兼容）
- add/update 增加 scope 参数；从 topic 新建默认 `scope=[topic:<key>]`
- CLI `template list/add/update` 对应 `--scope`/`--cwd` flag（缺省仍全局）

**解析器**（纯函数，单测钉死）：`visibleTemplates(rows, topic)` / `canUse` / `canEdit`
（edit = origin_topic 命中或 scope 显式含该 topic——编辑权比可见权严一档）。

**前端**：
- `use-templates.js` 增 `listFor(topic)`（旧 serve 无此参数 → 退回全量列表，前端已有
  unsupported 降级路径）
- dir 页下拉改用 `listFor(当前topic)` + 底部「为本目录新建模板…」
- group 页新建任务加同款 hover 下拉
- 设置 task-templates-section 加 scope chips 编辑

**不做**（over-engineering 护栏）：通用 resources 表、策略规则语言、include/继承语法、
per-topic 默认模板（hover 菜单让选择足够便宜，后续有真实需求再加）。

## 3. 风险与注意

- 路由字面量陷阱已处理过（PATCH /api/templates/default 载荷分派，#87）。
- 列表过滤只在 newtask 上做，engine 组装路径不受影响。
- 前后端版本偏差：新 query 参数在旧 serve 上会 404/「接口不存在」→ use-templates
  现有降级逻辑覆盖。
- 迁移全部带默认值，存量模板保持全局可见 = 零破坏。

## 4. 总评

提案的**方向正确**（scoped 可见性、实例化解耦、UI 形态都站得住）；六点中
1.3（scope 化）/1.4（实例化）/1.6（UI）可按原样落地；1.1（去类型）与 1.2（策略引擎）
需**降配**以贴合单操作者本地工具的现实——scope 列 + 纯函数解析器，保留升级到
完整策略引擎的接口形状；1.5（组合继承）YAGNI 推迟。整体分两步：
① scope 列 + 解析器 + 三处 UI；②（可选，等需求）role 统一与 include 语法。
