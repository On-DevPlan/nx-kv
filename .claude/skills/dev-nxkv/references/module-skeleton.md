# 模块骨架与分层

## 1. 依赖方向（单向）

```text
bin/cli.mjs ─┐
web 前端 ─────┼─→ /api ─→ runtime ─→ modules ─→ core
              │                     └→ shared ←─┘
              └→ shared（仅纯函数）
```

- `runtime → modules` 允许；`modules` 反向 import `runtime` 禁止（会成环）。
- `modules/A → modules/B` 只能经 B 的 `service.js` 导出面，禁止深入 `B/repo`、`B/*.js` 内部。
- `core/` 是跨模块原语（db、错误、模板引擎、workflow、路径、配置等），**不放业务**。
- `shared/` 只放无副作用纯函数/常量，前后端同构可用（如 `shared/prompt-blocks.js`）。
- 前端只消费 `/api/*`；`src/web/frontend` 不得 import 后端模块。
- 上述规则由 `eslint.config.js` 的 `no-restricted-imports` 与 `tests/unit/layering.test.mjs` 共同约束。
- **注意 lint 的模块禁列是枚举式**：当前列了 `repos/skills/github/bundled/system/todo/sessiontask`，其中 `skills/github/sessiontask` 已不存在；`setting` 未被列入（注释里的 `../settings/service.js` 是旧名笔误）。新增模块必须手动补 `'../<新模块>/*'`，漏补不会报错。`system` 是刻意放开的聚合模块。

## 2. 目录

```text
bin/cli.mjs                  CLI 入口（装配 runtime/cli.js）
src/runtime/                 registry / cli / api / server / cors / spec
src/core/                    db、errors、instruction-template、workflow、paths、config…
src/shared/                  前后端共享纯函数（prompt-blocks 等）
src/modules/<id>/
  index.js                   action 声明（CLI/HTTP 的唯一出口）
  service.js                 业务规则 / 事务边界
  repo/                      SQL 仓储（*.js）
  store-io.js / engine.js …  该域自己的实现文件
src/web/frontend/
  registry.js                视图登记（页面/面板）
  panels.jsx                 面板装配
  page/<name>/               页面
  modules/<name>/            可复用前端模块（md 编辑器、prompts、board…）
tests/unit/*.test.mjs        单测
tests/smoke.mjs              冒烟（假后端 + 临时配置）
scripts/                     lint 辅助（check-tdz）、link-local 等
assets/<skill>/              安装后给 agent 的技能（每个目录一个 SKILL.md）
```

当前模块（`src/runtime/registry.js` 的 `MODULES`）：`system`、`setting`、`auth`、`localtask`、`tasktool`、`todo`、`repos`、`docs`、`file`、`templates`、`bundled`、`db`。
注意：没有 `settings` 模块，目录名是 **`setting`**（eslint 注释里 `../settings/service.js` 是历史笔误）。

## 3. 模块骨架

### `index.js`：只放 action 声明

```js
import * as service from './service.js';

export default {
  id: 'demo',
  title: '演示',
  order: 100,
  actions: [
    {
      id: 'demo.list',
      cli: ['demo', 'list'],
      http: ['GET', '/api/demo'],
      summary: '列出演示项',
      flags: { limit: { type: 'number', default: 20 } },
      run: (ctx) => service.list({ limit: ctx.limit }),
      render: (d) => d.rows.map((x) => x.name).join('\n'),
    },
  ],
};
```

- 一个 action 同时声明 CLI 与 HTTP，二者不会分叉。
- `run` 只做入参归一与调用 service；SQL/事务不要写在这里。
- 注册时校验：`id`/CLI/HTTP 唯一、必须有 `cli`、`http` 必须是数组或显式 `null`、必须有 `run`。

### `service.js`：业务与事务

- 事务用 `txw((conn) => { ... })`；回调是**同步**的，里面不要 `await` 网络/文件 IO。
- 跨表写入、编号分配、依赖写入必须在同一事务。
- 抛错用 `core/errors.js` 的 `badInput` / `notFound` 等，保持 CLI 错误可读。

### `repo/`：SQL 仓储

- `open.js` 统一提供 `db()` / `txw`；SQL 只出现在 `repo/*.js`。
- 行 ↔ 领域对象映射集中在 `rows.js`（例：`tasks.body` → JSON `text`、`from_src` → `from`）。
- 新查询默认过滤 `deleted_at IS NULL`；确需包含软删行时在函数名/注释里写明。
- 时间戳统一 `core/db/time.js` 的 `nowMs()`；不要各自 `Date.now()`。

### 何时用 `ext` JSON

- 只放「展示附属信息」：icon、备注、原始远程列表、旧 id 取证等。
- **凡是要进 WHERE / 排序 / 唯一约束的字段，必须是真实列**（ext 无索引）。

## 4. 新增一个模块的步骤

1. 建 `src/modules/<id>/index.js`、`service.js`，需要持久化就建 `repo/`。
2. 在 `src/runtime/registry.js` import 并加入 `MODULES`。
3. 需要面板：在 `src/web/frontend/page/<id>/` 写视图，并登记到 `src/web/frontend/registry.js`。
4. 加测试：`tests/unit/registry.test.mjs` 会校验视图归属的模块已登记、视图文件存在、`/api` 字面量有对应路由；补该域单测。
5. 更新 `README.md` / `docs/` / `assets/`（若对使用者可见）。
6. 跑 `pnpm lint && pnpm test:unit && pnpm build`。

## 5. 前端骨架

- 页面组件放 `page/<name>/index.jsx`，必要时拆 section；大组件按功能拆分，避免单文件继续膨胀。
- 设置页在 `page/settings/`：`task-templates-section.jsx`（任务模板）、`prompt-templates-section.jsx`（区块模板列表）、`sidebar-section.jsx`（侧栏偏好）、`index.jsx`（装配）。
- 共享展示模块在 `modules/`：`md/`（Markdown 编辑器）、`prompts/`、`board/`。
- 任务详情页 `page/dir/task.jsx` 底部是常驻状态栏 + 可拖拽信息面板（附件 / check / 反馈 tab），偏好存 `localStorage` 的 `nxkv.taskDock*`；改这里只扩展同一套，不另起第二套面板。
- 路由/视图登记看 `frontend/registry.js`；面板布局看 `frontend/panels.jsx`。
- 前端状态与请求走 `api/client.js` 的 `api(path, {method, body})`，失败 `Error` 带 `.code`；不要自己拼鉴权头。
- 样式：新增优先写 `style-v2.css`（v2 tokens：`--paper/--ink/--soft/--wait/--doing/--live`）；`style.css` 是 v1 存量。
- 前端 `no-undef` 是开着的：漏 import 会在浏览器整页崩，lint 能拦。

## 6. assets/：用户侧 agent 的说明书

`assets/` 随包发布，由 `src/modules/bundled/` 的 `skill list/groups/install/get` 安装到 `~/.claude/skills`，或直接 `skill get` 吐全文：

```text
assets/
├── groups.json     # group 名 → skills[] + summary（别名表，不是第二事实源）
├── nx-kv/          # 每个目录一个 skill，必须有 SKILL.md
├── kv-get/
├── kv-submit/
└── kv-repo/
```

同步规则：

- 命令/flag/输出口径变了 → 改对应 `assets/<name>/SKILL.md` 与 `references/*.md`；`grep -rn "<命令名>" assets/` 找齐。
- 增删内置 skill → 建/删目录 + 同步 `groups.json`（group 名 kebab-case、`skills` 非空）。
- `groups.json` 缺失/错 schema 会降级成「每个目录各成一组」；测试 `bundled-multiskill.test.mjs` 用 `NX_KV_ASSETS` 指向伪资产树，**不要用测试改仓库里的 `assets/`**。
- assets 变化是对外行为，进 `CHANGELOG.md`。

## 7. 文件体量

单文件超过约 400 行就考虑拆分（service / repo / 子组件）。拆分按职责，不要按「代码行数」机械切。
