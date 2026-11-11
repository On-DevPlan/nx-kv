# E01 · 功能点 SOP：从需求到验收

> E 序列 · 交付流程。照着做，**不要从「先写代码」开始**。
> 每一步都给了产物与自检点；验证细则见 [[E02-验证与证据]]；坑清单见 [[E03-坑库]]。

## 0. 需求定性（5 分钟）

先回答四个问题，写进自己的草稿（不需要新文件）：

1. **属于哪个业务对象？** 对照 [[A01-数据模型]] §3 的表：仓库 / 项目组 / 主题 / 任务 / 文档 / 附件 / 时间目标 / 模板 / 设置。
2. **是新增能力，还是修正已有行为？** 修正行为要先找到**唯一入口**，不要复制第二条路径。
3. **涉及哪几层？** 按 [[B01-架构分层]] 判断：schema → repo/service → action（CLI/HTTP）→ 面板 → 内置技能/文档。
4. **「完成」的可观察判据是什么？** 一句话能描述、能用命令验证。

## 1. 侦察（先读，不改）

按顺序读：

1. [[A01-数据模型]] → [[A02-关系模型]] → [[B01-架构分层]] → [[B03-action契约]]。
2. 涉及提示词 → [[B04-提示词渲染链]]；涉及依赖/顺序/编排 → [[B05-依赖与工作流引擎]]。
3. 涉及后端接口 → [[C01-serve端]]；涉及面板 UI → [[D01-组件结构]] → [[D02-页面与组件关系]]。
4. 目标模块：`src/modules/<id>/index.js`（action 表）→ `service.js`（业务）→ `repo/*.js`（SQL）→ 相关 `core/*`。
5. 相关单测（`tests/unit/`）与 `tests/smoke.mjs`——**它们定义了既有契约**。

现成命令：

```powershell
node bin/kv.mjs routes --module <id>   # 现有命令/路由
node bin/kv.mjs help --json            # 可解析的命令表
```

查数据不要猜：

```powershell
node bin/kv.mjs db status
node bin/kv.mjs db verify
```

**产出**：一张「入口 → service → repo → 表/设置键 → 前端」的路径图。找不到唯一入口，先停下来讨论，**不要新增重复路径**。

## 2. 先定数据（写代码之前）

| 数据形态 | 放哪 | 规则 |
|---|---|---|
| 有查询条件、需要外键/事务/唯一约束 | SQLite 新表或新列 | 走新 migration（`vN+1.sql`）+ `migrations/index.js` 登记边；**已发布快照不改** |
| 全局偏好 / 全局开关 | `settings` 表 | k/v，JSON 值；不要加宽表 |
| 队列级 / 仓库级旋钮 | `topics.ext` / `repos.ext` | 随行走，不进 `settings` |
| 附属、永远不进 WHERE 的展示信息 | `<table>.ext` | 键名 `ext_` 前缀 |
| 任务正文模板 | `templates` 表 | 与提示词模板严格分开 |
| 凭据 | `config.json` | 绝不进库 |

同时定下：

- **身份**：队列用 `topics.id`（外键）/ `key`（对外寻址）；任务外键用 `tasks.id`，对外编号用 `seq`。
- **软删**：新增查询一律带 `deleted_at IS NULL`；不要一条路径软删、另一条硬删。
- **事务**：多表/多行写入必须放在一个 `txw(...)` 里；事务回调内禁止 `await` 非同步 IO。
- **唯一/竞态**：先想清楚并发新增时编号、key、唯一索引怎么不冲突；分配与插入同事务。
- **兼容**：旧数据、旧设置键、旧 JSON 迁移路径都要考虑；迁移函数必须**幂等**。

细节见 [[A01-数据模型]] 与 [[A03-键与扩展位]]。

## 3. 后端实现（单一入口）

1. **repo 层**：SQL 只写在 `modules/<id>/repo/*.js`；时间统一 `core/db/time.js` 的 `nowMs()`；JSON 列用现成 parse/stringify 辅助。
2. **service 层**：业务规则、事务边界、错误语义（`core/errors.ts` 的 `badInput` 等）。不要从 action 直接拼 SQL。
3. **action 层**：在 `modules/<id>/index.js` 增加 action：
   - `id`：`<module>.<verb>`，全局唯一；
   - `cli`：**必须有**，路径不得与现有命令重复；
   - `http`：给面板用就写 `[METHOD, '/api/...']`，纯 CLI 写 `null`；
   - `summary`：一句话说人话；
   - `args` / `flags`：类型、hint、默认值；`rest` 字段当前未启用，不要依赖；
   - `run`：只做编排与入参归一，不写业务；
   - `render`：CLI 人读输出；HTTP 返回结构化数据。
4. 需要动态 import 的重依赖 / 可选路径可以延迟 import，但不要制造循环依赖。

**自检**：`node bin/kv.mjs routes --module <id>` 能看到新命令；registry 启动自检通过（id/CLI/HTTP 不重复、`run` 存在）。

细节见 [[B02-action注册全表]] 与 [[B03-action契约]]。

## 4. 面板接入（需要 UI 时）

1. 页面放 `src/web/frontend/page/<name>/`，在 `src/web/frontend/registry.js` 登记；面板在 `panels.jsx` 的 `PANELS` 登记；设置类页面在 `page/settings/`。
2. 前端只调 `/api/*`；禁止 import 后端模块，只能用 `src/shared/` 的纯函数。
3. 复用现有 section / 编辑器组件，不要为同一功能再写一套表单。
4. 设置页保持分离：「任务模板」（`templates` 表）与「提示词区块模板」不要混在同一表单；提示词按区块各自一个模板列表，不要合成全局模板表单。
5. 面板寻址要**逐字互逆**：`panelSpecOfRoute` 生成的 config 必须能从 `routeOfPanel` 写回的路由复现，否则会裂出重复页签。

**自检**：`frontend-refs.test.mjs` / `registry.test.mjs` 通过；`pnpm build` 通过；实际打开页面走一遍。

细节见 [[D01-组件结构]] 与 [[D02-页面与组件关系]]。

## 5. 测试

- 行为变化 → 在 `tests/unit/` 加/改测试，命名跟现有风格（`<domain>-<behavior>.test.mjs`）。
- 数据库改动 → 同时跑 `pnpm test:db`，并补迁移/边界用例：多队列、并发、历史格式、软删、外键。
- 渲染改动 → 覆盖：保存拒绝坏语法、运行期回落 + `renderWarnings`、列表循环、旧配置迁移。
- 所有测试走 `tests/support/test-store.mjs` 的临时库；**禁止**默认 `~/.nx-kv/nxkv.db`。

## 6. 验证

严格按 [[E02-验证与证据]] 跑固定检查项，再按改动面补：

- 渲染/提示词：`localtask preview --id` + 一次真实 `localtask get` 的返回载荷。
- DB：`db backup` → `db migrate --dry-run` → `db migrate` → `db verify`。
- 面板：实际打开页面验证布局、交互、空态/错误态（注意 cache-buster）。

## 7. 文档与内置资产

- CLI/面板行为变了：更新 `README.md` 与 `docs/project&projectsCli.md` 的对应段落。
- 安装后的 agent 用法变了：同步 `assets/`（`nx-kv/`、`kv-get/`、`kv-submit/`、`kv-repo/`）与 `assets/groups.json`。
- 用户可见的变更：按仓库习惯记入 `CHANGELOG.md`。
- 改本开发 skill 时：同步 `.claude/skills/dev-nxkv/` 自己，别只改代码。

## 8. 提交

- 提交信息用 **Conventional Commits**（`feat(scope): …` / `fix(scope): …` / `docs(scope): …`），正文用中文说明「为什么」。
- 工作区可能有**并行会话**的改动：**只 `git add` 本次自己改的文件**，不要 `git add -A`。
- 默认只做本地提交；用户明确要求发布时才 push，且不强推、不动主干策略。
- 进度按需更新 `plan/todo.md`；对外行为变化进 `CHANGELOG.md`。
- 远端注意：本机 `git config remote.pushDefault` 可能指向不存在的远端，裸 `git push` 会失败——显式 `git push origin <branch>`。

## 9. 汇报（Definition of Done）

一条功能完成的汇报必须能回答：

1. 改动文件清单与每处作用；
2. **数据模型变化**（表/列/设置键，是否迁移，旧数据怎么办）；
3. **入口变化**（CLI 命令、HTTP 路由、面板位置）；
4. **验证命令与真实结果**（不要只说「通过」）；
5. 渲染/数据库证据（如适用）；
6. 未做事项、已知风险、需要用户确认的决策。
