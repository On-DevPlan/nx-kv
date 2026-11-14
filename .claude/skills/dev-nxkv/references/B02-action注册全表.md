# B02 · action 注册全表：126 条入口在哪

> B 序列 · 架构之二。回答「这个功能现在走哪条命令 / 哪个路由」「新增入口要登记到哪」。
> action 的字段与校验见 [[B03-action契约]]；模块与分层见 [[B01-架构分层]]。
>
> **本表是快照（2026-11-14 校准）。权威源永远是代码**：`node bin/kv.mjs routes` / `help --json`
> 与 `src/modules/*/actions/`。下表与命令输出不一致时，以命令为准，并顺手修本表。

## 1. 注册机制：一份声明，三张表

```text
src/modules/<id>/actions/<名>.ts  （一条 action 一个文件，@action + zod 契约内联）
            │  pnpm gen:actions 扫目录 → actions/_manifest.generated.ts
            ▼
   src/modules/<id>/index.ts  ModuleBase 子类装配（zodActionsOf + container.create）
            │
            ▼
   src/runtime/registry.ts   MODULES → ACTIONS，装载期自检
            │
            ├─→ src/runtime/cli.ts    ALL_COMMANDS → CLI 命令表 + help 文本
            ├─→ src/runtime/api.ts    ACTIONS → HTTP 路由表（compileRoute）
            └─→ src/core/command-table.ts  命令表快照 → /api/bootstrap 下发给面板
```

「Web 上每个操作都有等价 CLI 命令」是**结构性保证**，不是口头约定：一条 action 同时声明 `cli` 与 `http`，二者写在同一处，不可能分叉。

- **加一条 action 零登记**：新建 `actions/<名>.ts` → 跑 `pnpm gen` → 模块自动装配，`index.ts` 零改动。
- `registry.ts` 只汇合，不含任何前端路径——**前端怎么呈现，后端不知道也不该知道**。
- `command-table.ts` 这个「格子」存在的理由：`/api/bootstrap` 要给面板下发「每个操作对应的 CLI 命令」，而表由 runtime 装配；模块直接 import runtime 会成环。方向是单向的：`runtime → core`（写快照），`modules → core`（读快照）。没有快照时返回空数组（bootstrap 允许空表降级，面板仍能打开，只是没有 CLI 提示）。
- `cli.ts` 装配出的 `ALL_COMMANDS` 是 `ACTIONS` 的**超集**（多出平台命令），并在装配后覆盖一次快照。

## 2. 平台命令（3 条，不进 action 表）

| CLI | 归属 | HTTP | 说明 |
|---|---|---|---|
| `nx-kv serve` | platform | — | 启动 Web 面板（见 [[C01-serve端]]） |
| `nx-kv help [topic]` | platform | — | 帮助；`--json` 输出可解析的命令表 |
| `nx-kv version` | platform | — | 裸版本号（脚本里 `V=$(nx-kv version)`） |

`routes`（命令 ↔ 路由对照表）**已是 action**（`system.routes`，见下表 §3.1）：它的数据源是 `cli.ts` 的 `ALL_COMMANDS`，逻辑是 `src/modules/system/actions/routes.ts` / `src/modules/system/routes.ts` 里的纯函数，**表**由 runtime 传入——模块不 import runtime，面板也从 `/api/bootstrap` 拿同一张表。

## 3. 全量 action 表（按模块，共 126 条）

> **⚠ 本节部分小节已失效，勿照抄调用**：`§3.3 auth`（4 条）与 `§3.9 todo`（25 条）是 v7 本机化时
> **已删除的模块**（身份体系取消、待办迁入 `localtask`）。当前 `src/modules/` 只有 10 个模块：
> `bundled / db / docs / file / localtask / repos / setting / system / tasktool / templates`。
> 调用任何命令前先 `node bin/kv.mjs routes --module <id>` 核对；不存在就说明本表过期。

「HTTP」列为 `—` = 显式 `http: null`（纯 CLI 命令）。

### 3.1 `system`（3）

| CLI | HTTP |
|---|---|
| `bootstrap` | `GET /api/bootstrap` |
| `health` | `GET /api/health` |
| `routes` | —（面板从 `/api/bootstrap` 拿同一张表） |

### 3.2 `setting`（2）

| CLI | HTTP |
|---|---|
| `setting get` | `GET /api/setting` |
| `setting set` | `POST /api/setting` |

### 3.3 `auth`（4）

| CLI | HTTP |
|---|---|
| `auth login` | `POST /api/auth/login` |
| `auth logout` | `POST /api/auth/logout` |
| `auth status` | `GET /api/auth` |
| `auth me` | `GET /api/auth/me` |

### 3.4 `repos`（44）

仓库本体：

| CLI | HTTP |
|---|---|
| `repo list` | `GET /api/repos` |
| `repo get` | `GET /api/repos/:id` |
| `repo add` | `POST /api/repos` |
| `repo detect` | `POST /api/repos/detect` |
| `repo update` | `PATCH /api/repos/:id` |
| `repo remove` | `DELETE /api/repos/:id` |
| `repo scan` | `POST /api/repos/scan` |
| `repo open` | `POST /api/repos/open` |

仓库的 key 与 remote：

| CLI | HTTP |
|---|---|
| `repo key refresh` | `POST /api/repos/key/refresh` |
| `repo key set` | `POST /api/repos/key` |
| `repo key migrate` | `POST /api/repos/key/migrate` |
| `repo remote` | `POST /api/repos/remote` |
| `repo remote list` | `GET /api/repos/remote/list` |
| `repo remote pick` | `POST /api/repos/remote/pick` |
| `repo remote check` | `GET /api/repos/remote/check` |
| `repo clone` | `POST /api/repos/clone` |

参考仓库（ref）：

| CLI | HTTP |
|---|---|
| `repo ref clone` | `POST /api/repos/ref/clone` |
| `repo ref add` | `POST /api/repos/ref/add` |
| `repo ref sync` | `POST /api/repos/ref/sync` |
| `repo ref check` | `GET /api/repos/ref/check` |
| `repo ref backfill` | — |
| `repo ref note` | `POST /api/repos/ref/note` |
| `repo ref of` | `GET /api/repos/ref/of` |
| `repo bind` | `POST /api/repos/bind` |

仓库的文档与上下文：

| CLI | HTTP |
|---|---|
| `repo doc list` | `GET /api/repos/docs` |
| `repo doc add` | `POST /api/repos/docs` |
| `repo doc remove` | `DELETE /api/repos/docs` |
| `repo knowledge` | `GET /api/repos/knowledge` |

仓库的导入导出与主题绑定：

| CLI | HTTP |
|---|---|
| `repo export` | `GET /api/repos/export` |
| `repo import --diff` | `POST /api/repos/import/diff` |
| `repo import` | `POST /api/repos/import` |
| `repo bind-topics` | `POST /api/repos/bind-topics` |

项目组（board = 项目组，命令名沿用历史别名）：

| CLI | HTTP |
|---|---|
| `board list` | `GET /api/boards` |
| `board get` | `GET /api/boards/:id` |
| `board add` | `POST /api/boards` |
| `board update` | `PATCH /api/boards/:id` |
| `board remove` | `DELETE /api/boards/:id` |
| `board assign` | `POST /api/boards/assign` |
| `board rekey` | `POST /api/boards/rekey` |
| `board prune` | `POST /api/boards/prune` |
| `board note` | `POST /api/boards/note` |
| `board import` | `POST /api/boards/import` |
| `board export` | `GET /api/boards/export` |
| `board prefix` | `POST /api/boards/prefix` |

### 3.5 `docs`（14）

| CLI | HTTP |
|---|---|
| `docs list` | `GET /api/docs` |
| `docs get` | `GET /api/docs/item` |
| `docs add` | `POST /api/docs/item` |
| `docs set` | `PATCH /api/docs/item` |
| `docs remove` | `DELETE /api/docs/item` |
| `docs attachments` | `GET /api/docs/attachments` |
| `docs attach` | `POST /api/docs/attach` |
| `docs attach-note` | `PATCH /api/docs/attach-note` |
| `docs detach` | `DELETE /api/docs/attach` |
| `docs seed` | `POST /api/docs/seed` |
| `docs bind` | `POST /api/docs/bind` |
| `docs note-bind` | `POST /api/docs/note-bind` |
| `docs link` | `POST /api/docs/link` |
| `docs index` | `GET /api/docs/index` |

### 3.6 `localtask`（33）

任务本体：

| CLI | HTTP | 说明 |
|---|---|---|
| `localtask list` | `GET /api/localtasks` | |
| `localtask show` | `GET /api/localtasks/item` | action id `localtask.get`（CLI 动词与 id 不同名） |
| `localtask get` | `POST /api/localtasks/claim` | action id `localtask.claim`。**HTTP 不阻塞、不开浏览器**（面板/脚本调用不该挂住请求）；CLI 侧没任务默认立即返回，项目开启「持续 get」后可 `--timeout` 阻塞等人回填 |
| `localtask chain` | `GET /api/localtasks/chain` | |
| `localtask clone` | `POST /api/localtasks/clone` | |
| `localtask fork` | `POST /api/localtasks/fork` | |
| `localtask preview` | `POST /api/localtasks/preview` | |
| `localtask reopen` | `POST /api/localtasks/reopen` | |
| `localtask done` | `POST /api/localtasks/done` | |
| `localtask add` | `POST /api/localtasks` | |
| `localtask update` | `PATCH /api/localtasks/item` | |
| `localtask cancel` | `POST /api/localtasks/cancel` | |
| `localtask timegoal-log` | `GET /api/localtasks/timegoal-log` | |
| `localtask import-remote` | `POST /api/localtasks/import-remote` | |

批量：

| CLI | HTTP |
|---|---|
| `localtask remove` | `DELETE /api/localtasks/item` |
| `localtask remove-many` | `DELETE /api/localtasks/items` |
| `localtask cancel-many` | `POST /api/localtasks/items/cancel` |
| `localtask close-many` | `POST /api/localtasks/items/close` |
| `localtask task restore` | `POST /api/localtasks/tasks/restore` |

附件：

| CLI | HTTP |
|---|---|
| `localtask attach` | `POST /api/localtasks/attach` |
| `localtask detach` | `DELETE /api/localtasks/attach` |
| `localtask attach-note` | `PATCH /api/localtasks/attach-note` |
| `localtask attachments` | `GET /api/localtasks/attachments` |

主题与队列配置：

| CLI | HTTP |
|---|---|
| `localtask topic add` | `POST /api/localtasks/topic` |
| `localtask topic remove` | `DELETE /api/localtasks/topic` |
| `localtask topic remove-many` | `POST /api/localtasks/topics/remove` |
| `localtask config` | `PATCH /api/localtasks/setting` |
| `localtask prune` | `POST /api/localtasks/prune` |
| `localtask reorder` | `PATCH /api/localtasks/reorder` |
| `task move` | `POST /api/task/move` |

等待与事件：

| CLI | HTTP |
|---|---|
| `localtask wait` | —（纯 CLI：阻塞等人回填） |
| `localtask presence` | `GET /api/localtasks/presence` |
| `localtask events` | `GET /api/localtasks/events`（SSE 长连接，`stream: true`） |

### 3.7 `tasktool`（8）

| CLI | HTTP |
|---|---|
| `timegoal set` | `POST /api/timegoals` |
| `timegoal update` | `PATCH /api/timegoals` |
| `timegoal show` | `GET /api/timegoals` |
| `timegoal check` | `GET /api/timegoals/check` |
| `timegoal clear` | `DELETE /api/timegoals` |
| `timegoal list` | `GET /api/timegoals/all` |
| `timegoal log` | `GET /api/timegoals/log` |
| `timegoal prune` | `POST /api/timegoals/prune` |

### 3.8 `templates`（5）

| CLI | HTTP |
|---|---|
| `template list` | `GET /api/templates` |
| `template add` | `POST /api/templates` |
| `template update` | `PATCH /api/templates/:id` |
| `template remove` | `DELETE /api/templates/:id` |
| `template default` | `PATCH /api/templates/default` |

> ⚠️ `PATCH /api/templates/default` 是**字面量路由**，与 `PATCH /api/templates/:id` 都能匹配同名路径。编译后按「字面量在前」排序，所以字面量总是赢——但静态路由必须**自己按载荷分派**（见 [[B03-action契约]] §4）。

### 3.9 `todo`（25）

云端工作空间（`group` = cloud workspace，与项目组不是一回事）：

| CLI | HTTP |
|---|---|
| `group list` | `GET /api/groups` |
| `group get` | `GET /api/groups/:id` |
| `group add` | `POST /api/groups` |
| `group update` | `PATCH /api/groups/:id` |
| `group remove` | `DELETE /api/groups/:id` |
| `group current` | `GET /api/group` |
| `group use`（别名 `group switch`） | `POST /api/group` |
| `group members` | `GET /api/groups/:id/members` |

清单条目：

| CLI | HTTP |
|---|---|
| `todo list` | `GET /api/todo` |
| `todo get` | `GET /api/todo/item` |
| `todo add` | `POST /api/todo` |
| `todo update` | `PATCH /api/todo/item` |
| `todo remove` | `DELETE /api/todo/item` |
| `todo attach` | `POST /api/todo/attach` |
| `todo attachments` | `GET /api/todo/attachments` |
| `todo done` | `POST /api/todo/done` |
| `todo freeze` | `POST /api/todo/freeze` |
| `todo unfreeze` | `POST /api/todo/unfreeze` |
| `todo archive` | `POST /api/todo/archive` |

云端主题与提示词：

| CLI | HTTP |
|---|---|
| `topic list` | `GET /api/topics` |
| `topic add` | `POST /api/topics` |
| `topic remove` | `DELETE /api/topics` |
| `prompt get` | `GET /api/prompts/:topic` |
| `prompt set` | `POST /api/prompts/:topic` |
| `prompt remove` | `DELETE /api/prompts/:topic` |

### 3.10 `file`（8）

| CLI | HTTP |
|---|---|
| `file list` | `GET /api/file` |
| `file upload` | `POST /api/file` |
| `file get` | `GET /api/file/item` |
| `file remove` | `DELETE /api/file/item` |
| `file content` | `GET /api/file/content/:fileId` |
| `file orphans` | `GET /api/file/orphans` |
| `file prune` | `POST /api/file/prune` |
| `file sync` | `POST /api/file/sync` |

### 3.11 `bundled`（4）

| CLI（别名） | HTTP |
|---|---|
| `skill list`（`skill install --list` / `bundled list`） | `GET /api/bundled` |
| `skill groups`（`bundled groups`） | `GET /api/bundled/groups` |
| `skill install` | `POST /api/bundled/install` |
| `skill get` | `GET /api/bundled/content` |

### 3.12 `db`（4）

| CLI | HTTP |
|---|---|
| `db status` | — |
| `db migrate` | — |
| `db verify` | — |
| `db backup` | — |

## 4. 装载期自检（服务一起来就验）

`src/runtime/registry.ts` 的 `Registry.create` 在装配阶段逐条检查，**启动瞬间**暴露问题，而不是等某个用户敲到那条命令时才发现：

1. `id` 重复；
2. action 没有任何 CLI 路径（**每条 action 必须有 `cli`**——保证「Web 上能做的，CLI 都能做」）；
3. CLI 路径重复；
4. HTTP 路由重复（`method + path`）；
5. `http` 既不是路由数组也不是**显式** `null`；
6. 缺少 `run`；
7. `flags.rest` 不在 `flags` 的**最后一位**（仅 legacy flags 通道；zod 通道用 `restArg`，无此约束）。

`http` 为 `null` 是合法声明（如 `db` 诊断命令），不是漏写；但**不允许**声明 `http` 却没有 `cli`。

## 5. 命令 ↔ 路由反查（核对用）

```powershell
node bin/kv.mjs routes                      # 全量对照（129 行：126 action + 3 平台命令）
node bin/kv.mjs routes --module localtask   # 只看某模块
node bin/kv.mjs routes --http "POST /api/localtasks/preview"
node bin/kv.mjs help --json                 # 与 routes 同源同长（129 条）
```

本表如与 `node bin/kv.mjs routes` 不一致，**以命令输出为准**（代码是唯一真相，本表只是快照）。

## 6. 新增一条 action 要落在哪

1. `src/modules/<id>/actions/<名>.ts` 新建一个文件：zod 契约内联（`input`）+ `@action` 元数据 + `override run`（字段与样板见 [[B03-action契约]]）。
2. 业务函数写进同模块 `service.ts`（普通对象入参 / 返回；SQL 与事务不进 action）。
3. 跑 `pnpm gen`（gen:actions 收清单 + gen:api 刷新前端 typed client 与 cli-tree）。
4. 需要面板入口：前端页面在**本页 `api.ts`** 加调用函数并在组件里消费（见 [[D02-页面与组件关系]]）。
5. 启动自检必须通过（id / CLI / HTTP 不重复、`run` 存在）。
6. `node bin/kv.mjs routes --module <id>` 能看到新命令。
7. 文档同步：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`；命令口径变了再同步 `assets/`。
