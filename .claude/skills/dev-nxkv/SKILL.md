---
name: dev-nxkv
description: 在 nx-kv 仓库里开发或改动一个功能模块时的施工单 —— 分层边界、模块骨架、action 声明格式、CLI/HTTP/面板三端同源、注册与自检、常见坑。触发词：开发 nx-kv 模块、nx-kv 加功能、nx-kv 改 action、加一条 CLI 命令、加一个面板视图、模块怎么分层、模块结构、dev nx-kv、nx-kv 架构、DAG 怎么实现、blockBy / 闸门 / 依赖怎么改、编排面板、tasktool plugins。凡「要动 nx-kv 仓库里的模块代码」都走本 skill；只是**用** nx-kv（领任务 / 操作清单 / 提交任务）请走 nx-kv、kv-get、kv-submit，不要走本 skill。
---

# dev-nxkv — 在 nx-kv 里开发一个模块

nx-kv 的形状一句话说清：**一份 action 声明，同源派生 CLI 命令、HTTP 路由与面板入口**。
开发本仓库 = 在这条同源链上再接一段。

> 只用 nx-kv 不改代码 → 走 `nx-kv` / `kv-get` / `kv-submit`。
> 要改代码 → 本 skill。

## 先定位你在改哪一层

| 层 | 目录 | 职责 | 允许依赖谁 |
| --- | --- | --- | --- |
| core | `src/core/` | 跨模块共享的原语（错误类型、路径、配置、KV 后端客户端、附件落盘、zip…） | 只依赖 Node 内置 |
| modules | `src/modules/<name>/` | **业务真相源**：一个功能域的 service + action 声明 | core |
| runtime | `src/runtime/` | 传输壳：命令解析（cli.js）、路由分发（api.js）、HTTP 服务（server.js）、注册表（registry.js）、规格（spec.js） | core + modules |
| web | `src/web/frontend/` | React 面板（视图、组件、样式） | 只 import 视图与纯前端 .js |

依赖方向**单向向下**：`web → modules(视图) → modules(service) → core`。
越界会被 eslint 直接报错（见「硬边界」）。

## 动手前：三张表要对齐

加一个模块或一条能力，下面三处必须同步，漏一处 `tests/unit/registry.test.mjs` 就红：

1. **模块目录** `src/modules/<name>/`（有 `index.js` 才算数）
2. **后端注册表** `src/runtime/registry.js` 的 `MODULES`（决定 CLI 命令与 HTTP 路由）
3. **前端视图注册表** `src/web/frontend/registry.js` 的 `VIEWS`（决定 tab 与面板）

面板还要在 `src/web/frontend/panels.jsx` 登记面板类型与路由（`PANEL_ORDER` / `routeOfPanel`）。

## 模块骨架

最小可跑的一组文件（逐行注解见 [[module-skeleton]]）：

```
src/modules/<name>/
├── index.js     模块声明 + action 表（cli/http 同处一条）
└── service.js   业务真相源：不认识 argv、不认识 HTTP

src/web/frontend/page/<name>/index.jsx   面板视图（可选，写在前端注册）
src/shared/*.js                          两端共用的纯函数（可选，零依赖）
```

**前端不写进后端目录**：模块里没有 `view`、没有 `.jsx`、不 import react。
面板只通过 `/api` 消费后端；真要两端共用一份实现（正则、解析、拼装），
放到 `src/shared/`——它同时被 Node 与浏览器加载，所以不许碰 `node:` 和第三方包。
这几条都由 `eslint.config.js` 与 `tests/unit/layering.test.mjs` 双保险。

## action 声明

一条 action = 一条 CLI 命令 + 一条 HTTP 路由 + 一个面板入口，字段与类型见 [[action-contract]]：

```js
{
  id: 'todo.add',                    // 全局唯一
  cli: ['todo', 'add'],              // 也可写别名：[['a','b'],['c','d']]
  http: ['POST', '/api/todo'],       // 或显式 null（纯 CLI 命令）
  summary: '一句话说明（进 help 与面板提示）',
  args: ['text'],                    // 位置参数；对象可声明 optional / required:false
  flags: { topic: { type: 'string', hint: '主题' } },
  run: (ctx) => service.add(ctx),
  render: (d) => `已添加: ${d.id}`,   // CLI 输出一行
}
```

## 硬边界（写错会被 lint / 装载期自检拦下）

- `core/` **不得** import modules / runtime / web。
- `modules/` 之间**不得**互相 import（要共享就下沉到 `core/`）；例外只有 `settings` 与聚合模块 `system`。
  新增模块还要把 `../<新模块>/*` 补进 `eslint.config.js` 的禁列——**漏补是静默的**。
- 前端**不得** import `modules/*/index.js`、`modules/*/service.js`、`runtime/**`、`core/**`：
  这些是 Node 侧代码，拖进浏览器包会把 `node:` 内置模块一起带进来。
  前端只 import 视图，以及模块目录里**纯前端**的 `.js`（如 `modules/md/md-parse.js`）。
- `rest` flag 必须声明在 `flags` 的**最后**（CLI 路径最长匹配，声明顺序决定谁吃掉下一个 token）。
- 每条 action **必须**有 `cli`；`http` 可以是 `null`，但不能「声明了 http 却没有 cli」。

## DAG / 编排系统（动依赖、闸门、编排面板前先读）

任务的先后顺序有**四种表达**：队列序（数组 + reorder）、blockBy 本地依赖、
闸门（blocksFollowing，按数组序挡后续）、跨队列依赖（blockBy 里的 `"topicKey:id"`，
组编排边，对 get 生效）。真相源是任务行，引擎快照只是投影；就绪判定有任务行/快照
两条入口；`resolveForeign` 必须在三处调用点都传。动 `core/workflow/**`、localtask
的依赖路径、tasktool/plugins（goal 族）、或前端编排面板（page/dag、dag-editor、组页
拖排序）任何一处前 → [[dag-system]]。

## 前端怎么挂

- 新页面：`src/web/frontend/page/<name>/index.jsx` → `registry.js` 登记 `VIEWS`（带 `module:` 归属）→ `panels.jsx` 加面板与路由。
- 共用片段：`src/web/frontend/components/`；纯前端多文件视图：`src/web/frontend/modules/<name>/`。
- 样式：新增优先写进 `style-v2.css`（v2 tokens：`--paper/--ink/--soft/--wait/--doing/--live`），`style.css` 是 v1 存量。
- 调后端：一律 `api('/api/...')`（`api/client.js`，失败抛 `Error` 带 `.code`）。
  **路径必须真实存在**——`registry.test.mjs` 会全量扫前端源码里的 `/api/` 字面量并对路由表。

## assets/ —— 内置 skill 包（改命令就要同步改它）

`assets/` 随包发布，是**用户侧 agent 的说明书**：`src/modules/bundled/` 通过
`skill list / groups / install / get`（CLI + HTTP 同源）把它装进 `~/.claude/skills`，
或用 `skill get` 直接吐全文给不读 skills 目录的外部 agent。

```
assets/
├── groups.json            # group 名 → skill 名数组 + summary（便捷别名表）
└── <name>/                # 一个内置 skill（nx-kv / kv-get / kv-submit / kv-repo）
    ├── SKILL.md           # 事实源：有它才算一个 skill
    └── references/*.md    # 按需加载的细节文档
```

同步规则：

- **命令口径变了**（加 / 改 / 删 action、flag、输出口径）→ 对应 `assets/<name>/SKILL.md`
  与 `references/*.md` 里的用法串一起改；`grep -rn "<命令名>" assets/` 找齐所有出现点。
- **新增 / 删除内置 skill** → 建 / 删目录（必须有 `SKILL.md`）+ 同步 `assets/groups.json`
  （group 名 kebab-case、skills 非空数组、summary 一句话）。
- `groups.json` 只是别名表：缺失 / schema 错会**降级**为「每个目录各成一组」；
  别往里塞 SKILL.md 没有的东西，它不是第二条事实源。
- assets 的变化是**对外行为** → 进 CHANGELOG。
- 相关测试 `tests/unit/bundled-multiskill.test.mjs` 用 `NX_KV_ASSETS` 指向伪资产树
  验降级 / schema 错——测试**绝不真改**仓库里的 `assets/`。

## 常见坑（都是踩过的）

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| 整页白屏 / `X is not defined` | 前端漏 import，或把 Node 侧模块拖进前端 | 前端 `no-undef` 是开着的；查 import 与禁列 |
| `Cannot access 'X' before initialization` | 先引用后声明（useMemo 用到后面才声明的变量） | `node scripts/check-tdz.mjs --all` 会点名 |
| 启动即抛「命令重复 / action id 重复」 | 两个 action 声明了同一路径 | `runtime/registry.js` 的装载期自检 |
| 路由撞车（改单条却命中列表） | CRUD 路由形状不合规 | 见 [[action-contract]] 的 CRUD 契约 |
| 面板调了接口却 404 | `/api/...` 路径与路由表不一致 | 测试会扫出来；对照 `nx-kv routes` |
| 「缺改/缺删」没人发现 | 声明了 `resource` 却不齐五个动词 | 见 [[action-contract]] 的 CRUD 契约 |
| eslint 报「别用任务 id 拼定位路径」 | 清单任务 id 会重复，定位必须用**内容** | `/api/todo/item` + body 里带内容；这条是 lint 硬规则 |
| 用户装的 skill 说明书还是旧口径 / `skill get` 吐旧用法 | 改了命令没同步 `assets/` 里的文档 | 按「assets/」一节同步；`grep -rn "<命令>" assets/` 找齐 |

## 验收

```bash
pnpm run lint        # eslint + check-tdz（先引用后声明）
pnpm run build       # vite build（前端能不能打进包）
pnpm run test:smoke  # HTTP 端到端冒烟
pnpm run test:unit   # node --test tests/unit/*.test.mjs
pnpm test            # 以上四步全跑
```

改了前端还要**真跑一遍**：`node bin/cli.mjs serve`，浏览器点一遍（改样式/交互后记得清缓存）。

## 提交与文档

- Conventional Commits，中文正文，本地 commit 不 push。
- 同工作树可能有并行会话：**只 `git add` 自己改过的文件**，绝不 `git add -A`。
- 同步：`plan/todo.md`（进度）、`CHANGELOG.md`（对外变化）、`docs/project&projectsCli.md`（命令口径）。
- 行为变了但命令没变 → 只改文档；命令变了 → 文档与 `assets/` 里的用法串一起改（见「assets/」一节）。

## 参考

- [[module-skeleton]] —— 分层地图、模块骨架、前端视图骨架、注册三步
- [[action-contract]] —— action 字段全表、flag 类型、CRUD 契约、装载期自检
- [[dag-system]] —— DAG 体系全图：四种顺序表达、blockBy 解析（local/foreign）、
  投影不变式、Mutator/Scheduler 约束、goal 插件族、编排面板三入口、常见坑
