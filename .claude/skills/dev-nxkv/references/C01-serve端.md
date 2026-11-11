# C01 · serve 端：进程、路由、跨域、端口

> C 序列 · serve 端。回答「面板后端怎么起、请求怎么进来、跨域与端口冲突怎么办」。
> action 声明与全表见 [[B02-action注册全表]]；前端侧见 [[D01-组件结构]]。

## 1. 进程链路

```text
bin/kv.mjs
  ├─ checkNodeVersion()                    ← 必须在任何业务 import 之前
  │    （否则用户看到 ERR_UNKNOWN_BUILTIN_MODULE + 栈，完全指不出「Node 太老」）
  └─ dynamic import → src/runtime/cli.ts
       └─ resolveCommand(argv) → cmdServe(ctx)
            ├─ src/runtime/server.ts  startServer()
            ├─ src/core/serve-port.ts resolvePortConflict() / findFreePort() / probePanel()
            ├─ src/core/open.js      openBrowser()
            └─ src/modules/localtask/panel-guard.js  空闲自释放看门狗（仅 --auto-exit）
```

`serve` 的 flag：

| flag | 说明 |
|---|---|
| `--port N` | 端口（默认 `7877`，`src/core/paths.ts` 的 `DEFAULT_PORT`） |
| `--no-open` | 不自动开浏览器（本次） |
| `--allow-origin <list>` | 跨域来源白名单（逗号分隔，支持 `*` 通配）；缺省放行全部 |
| `--auto-exit` | 面板关闭且无等待中的主题后自动退出（`wait` 临时拉起 serve 时用） |
| `--idle N` | 空闲宽限期秒数（与 `--auto-exit` 配合，默认 120） |

全局开关：`NX_SERVE_NO_OPEN=1`（`1/true/yes/on`）禁止**自动开浏览器**（正常启动与端口复用都算）。优先级：`--no-open` > 环境变量 > 默认允许。

主机固定 `127.0.0.1`（本机工具）。

## 2. 请求分派（`src/runtime/server.ts`）

`node:http` 零依赖服务器，只做两件事：发静态面板文件 + 把 `/api/*` 交给路由层。

```text
每个请求
  ├─ onRequest(req)                 活动观测钩子（只上报，不参与响应，异常必须吞掉）
  ├─ 补 CORS 头（静态页与 /api 都要带）
  ├─ OPTIONS 预检（/api/* 且带 Access-Control-Request-Method）→ 204 + 预检头
  ├─ /api/ping                      → { ok, data: { pong, ts } }（纯本机快返回）
  ├─ /api/*                         → handleApi()
  └─ 其他                           → serveStatic()
```

- `/api/ping` 与 `/api/health` 刻意分开：`ping` 不触网、不读盘、不查登录态，只测「端口上还活着」，适合 15s 一次的高频探活；`health` 走更重的鉴权/状态检查。
- 异常统一包成 `{ ok: false, error, code: 'INTERNAL' }` + HTTP 500。

### 静态文件

- 根目录 `PUBLIC_DIR` = `src/web/public`（vite `outDir` 的构建产物，**gitignore**）。没构建过就没有静态文件——面板打不开，先 `pnpm build`。
- 越界校验：解析成绝对路径后必须仍落在 `PUBLIC_DIR` 内（比对解析结果，而不是剥离 `..` 字面量——后者挡不住编码变形）。越界 → 403。
- MIME 表覆盖 html/js/mjs/css/json/svg/png/jpg/webp/ico/woff2/map；`cache-control: no-store`。

## 3. HTTP 路由（`src/runtime/api.ts`）

**这里没有手写路由**——每条路由都来自某个模块的 action 声明，所以「面板上有按钮、CLI 里没命令」在结构上不可能发生。

```text
ACTIONS.filter(a => a.http)
  → compileRoute(action)            模式 → { method, keys, regex }
  → sort(compareRoutes)             字面量段优先 → 段数多的优先
  → handleApi(req, res, url)
```

### 路由排序（关键）

逐段比较两条模式：

1. **字面量段优先于参数段**——`GET /api/repos/status` 优先于 `GET /api/repos/:id`；
2. 段数多的优先。

**为什么要排序而不是按声明顺序**：两条路由都能匹配 `/api/repos/status` 时，谁先声明谁赢。一旦有人调整 `actions` 顺序，静态路由就会被参数路由抢走——这种 bug 只在运行时、且只在特定路径上出现，极难排查。排序后声明顺序不再影响匹配结果。

> 推论（写新 action 时要记住）：**静态路由要自己按载荷分派**。`PATCH /api/templates/default` 若被 `PATCH /api/templates/:id` 抢走，`id=default` 的模板就存不进去。

### 请求处理

| 环节 | 行为 |
|---|---|
| 路径参数 | `route.keys` 逐个 `decodeURIComponent` |
| 查询串 | GET/HEAD 从 `url.searchParams` 取；其他方法从 body 取 |
| body | JSON 解析；解析失败按 `{}` 处理（不因此 500） |
| body 上限 | `MAX_BODY_BYTES = 24MB`（附件上传走 base64 JSON，10MB 图片 ≈ 13MB JSON；没有上限就等于「一个请求能吃掉全部内存」） |
| 参数强转 | `applySpec(action, raw)`——与 CLI 同一套（见 [[B03-action契约]]） |
| stream 模式 | `action.stream` 为真时把 `req/res/url` 透传给 `run`（`ctx.__raw`），action 自己接管响应（SSE、附件本体） |
| 正常返回 | `200 { ok: true, data }` |
| 出错 | `toErrorPayload(err)` → `{ ok: false, error, code, details? }`，状态码由 `httpStatusOf(code)` 映射 |
| 未命中 | `404 { ok: false, error: '接口不存在: METHOD /path' }` |

### 这里**不**按 Origin 拒绝写请求（任务 #57）

浏览器对 POST/PUT/DELETE **一律带 Origin 头**，哪怕请求与页面同源。原校验「Origin 主机名必须是 127.0.0.1/localhost」把「自己面板经内网穿透从手机访问」判成跨站 → 403，任务提交不了。误伤远大于收益。

现在的分工：同源（含隧道同源）不需要 CORS 头；跨源由浏览器先发 OPTIONS 预检，服务端回 CORS 头才放行；非浏览器客户端（curl / 原生 App / agent）本来就不带 Origin。

**安全边界**：面板只绑 `127.0.0.1`，是本机工具。一旦经内网穿透暴露到公网，**真正的边界是隧道自身的访问控制**（访问密码 / basic auth / IP 白名单）——任何非浏览器客户端都能直接调 API，从头到尾不经过 Origin 校验。想收紧来源用 `--allow-origin`。

## 4. CORS（`src/runtime/cors.ts`）

| 函数 | 作用 |
|---|---|
| `parseAllowOrigin(spec)` | 逗号分隔 → `{ all, list }`；`''` / `*` / 含 `*` ⇒ 全放行 |
| `originAllowed(origin, allow)` | 名单匹配，支持 `https://*.example.com` 通配（首段必须贴在开头，尾段必须贴结尾） |
| `isPreflight(req)` | `OPTIONS` + 带 `Access-Control-Request-Method` |
| `corsHeaders(req, allow)` | 允许时给 `access-control-allow-origin`（全放行 ⇒ `*`，否则回显具体 origin）+ `vary: Origin` |
| `preflightHeaders(req, allow)` | 回显本次请求涉及的方法与请求头；`max-age=600` |

- 无 Origin 的请求**不加** CORS 头（只 `vary: Origin`）。
- 来源不在名单里**故意不加** `allow-origin`——让浏览器自己拦下这次跨源请求，而不是服务端回 403（那会把「跨源不支持」和「请求出错」混成一种状态码）。

## 5. 端口协商（`src/core/serve-port.ts`）

这份文件在所有 nx-xx 面板之间**逐字节相同**——改一处就要全量同步，否则「口径统一」这件事本身会悄悄分叉。

| 环节 | 行为 |
|---|---|
| `probePanel(port, host, timeoutMs, headers)` | `GET /api/bootstrap`，短超时。响应里的 `app.name` 是**跨项目唯一的认领签名** |
| `resolvePortConflict(port, appName, host)` | 探测结果 `app.name === appName` ⇒ `reuse`；否则 `shift` |
| `findFreePort(start, host)` | 从 `start` 起逐个试，最多 50 个（`net.Server` 临时探测，立刻关闭） |
| `describeOccupant(occupant)` | 占用者的一句话描述；探测不到就是「未知服务」 |

- **reuse**：端口上跑的就是本项目的面板 → 复用，不再起第二个进程。起第二个会让「切项目」变成「切端口」，而用户想看的其实是已经开着的那一个。
- **shift**：端口被别的东西占着 → 顺延到下一个空闲端口再起自己的面板。
- **探测窗口 1500ms**（`PROBE_TIMEOUT_MS`）：面板的 bootstrap 不一定是纯本机计算——登录后要去后端拉分组，链路一慢就超过 800ms。窗口太窄的后果不是「探测失败」这么轻，而是**把自己的面板误判成别人的服务**，白起一个实例、占掉第二个端口——恰好是这套机制要消灭的体验。所以超时会**再等一次**。
- 端口协商成功后 `registerPanel(boundPort)` 登记自己：presence 要能问**所有**跑着面板的端口（只问 7877 会看不见 `serve --port` 或自动顺延出来的面板 → `wait` 会多开窗口）。进程退出时 `unregisterPanel`。

## 6. bootstrap 与命令表下发

`GET /api/bootstrap`（`src/modules/system/index.js` 的 `system.bootstrap`）返回：

| 字段 | 内容 |
|---|---|
| `app` | `{ name: 'nx-kv', version }` —— **跨项目认领签名** |
| `version` / `configPath` / `baseUrl` | 版本与配置路径 |
| `loggedIn` / `email` / `userId` / `groupId` | 登录态（读 `config.json`） |
| `groups` / `groupsError` | 云端工作空间列表；**拉取失败不致命**（未登录时面板仍应能打开并提示去登录） |
| `defaultPort` | 默认端口 |
| `projectRoot` | serve 进程的工作目录（仓库页「扫描」的缺省根目录用它——面板进程 cwd 即宿主项目） |
| `commands` | 命令表快照（`core/command-table.ts`），供面板显示「CLI 等价」提示；没有快照时给空数组，面板照常打开 |

## 7. 空闲自释放（`--auto-exit`）

`src/modules/localtask/panel-guard.js` 的 `startPanelIdleGuard({ server, idleSec })`。

- 看门狗要等 server 起好才创建，所以 `onRequest` 回调通过一个可变 holder 始终指向当前的 `noteActivity`。
- ⚠️ 这里以前是空函数——于是看门狗的 `noteActivity()` 从来没被调用过，空闲时长是从**进程启动**算起的，用户正用着面板也会被自动释放。
- 每个请求还会 `notePanelRequest()`：SSE 只挂在本地任务页，用户切到别的页时 presence 会误判面板已关闭。

## 8. 事件流（SSE）

`localtask events`（`GET /api/localtasks/events`，`stream: true`）——实现见 `src/modules/localtask/events.js`。

- 事件流**不依赖进程内回调**（`wait` 与常驻面板通常是两个进程，内存 EventEmitter 跨不过进程），而是轮询 store，从 `waiting` / `waitingUntil` 与「已领取数」的变化里派生事件：`waiting` / `reminder`（剩余 30s、10s）/ `resolved`（delivered | timeout）。
- SSE（HTTP）与 NDJSON（CLI）**共用同一个生成器** `watchEvents`。
- HTTP 与 CLI 按传输方式分流：HTTP → SSE（`req/res` 透传，`api.js` 只在 HTTP 下注入 `ctx.__raw`）；CLI → NDJSON。
- `cancelled` **不算** delivered：作废的任务没有交给任何领取方，算进去会在任务被取消时误报 resolved。

## 9. 改 serve 端时的检查清单

1. 新接口 = **新 action**（`cli` 必有），不要在 `api.js` 手写路由（那会绕过 CLI 等价与注册期自检）。
2. 改路由匹配 → 记住「字面量优先」的排序规则，不要靠声明顺序。
3. 改 CORS → 别把「拒绝跨源写请求」加回来（见 §3 的事故说明）。
4. 改端口 → `core/serve-port.ts` 是跨项目共享文件，改一处要全量同步。
5. 改完实际打开面板验证（构建产物要先 `pnpm build`；`src/web/public` 是 gitignore 的构建结果）。
6. 面板改动的端到端验证可用 `nx-kv-panel-probe` skill（独立 store + 临时端口 + Playwright 探针，绝不碰用户真实队列）。

## 10. 关键文件

| 文件 | 作用 |
|---|---|
| `bin/kv.mjs` | Node 版本硬拦 + 入口 |
| `src/runtime/server.ts` | HTTP 服务器、静态文件、请求分派 |
| `src/runtime/api.ts` | 路由编译与排序、body 读取、错误映射 |
| `src/runtime/cors.ts` | 跨域策略 |
| `src/runtime/spec.ts` | 参数强转（CLI/HTTP 共用）、路由正则、用法串 |
| `src/core/serve-port.ts` | 端口协商、探测、自动开浏览器策略 |
| `src/core/command-table.ts` | 命令表快照格子 |
| `src/core/open.js` | 打开浏览器 |
| `src/modules/system/index.js` | `bootstrap` / `health` |
| `src/modules/system/routes.js` | `routes` 的纯逻辑 |
| `src/modules/localtask/panel-guard.js` | 空闲自释放看门狗 |
| `src/modules/localtask/events.js` | 等待事件流（SSE / NDJSON 共用生成器） |
| `src/modules/localtask/panel-presence.js` | 面板登记与 presence |
