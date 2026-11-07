# Action 契约（CLI / HTTP 单一出口）

## 1. 一条 action 的形状

```js
{
  id: 'localtask.preview',                  // 全局唯一，<module>.<verb>
  cli: ['localtask', 'preview'],            // 必有；可为多路径别名
  http: ['POST', '/api/localtasks/preview'], // 可选；纯 CLI 写 null
  summary: '一句话说人话',                   // help / routes / 面板提示
  args: ['id'],                             // 位置参数；字符串=必填，对象可 optional
  flags: {
    id: { type: 'number', hint: '任务编号' },
    text: { type: 'string', hint: '草稿正文' },
  },
  run: async (ctx) => service.preview(ctx), // 只编排，不写业务
  render: (data) => '人读文本',               // CLI 输出；HTTP 忽略
}
```

### 字段全表

| 字段 | 必填 | 位置 | 说明 |
|---|---|---|---|
| `id` | 是 | action | 全局唯一；重复启动即抛错 |
| `cli` | 是 | action | 路径数组；别名 `[['a','b'],['c','d']]`；没有 `cli` 直接失败 |
| `http` | 是 | action | `[METHOD, '/api/...']` 或显式 `null`；不能缺、不能是别的形状 |
| `summary` | 建议 | action | `help --json` / `routes` / 面板展示 |
| `args` | 否 | action | 字符串 = 必填位置参数；`{ name, required: false }` 可选 |
| `flags` | 否 | action | 见下 |
| `run` | 是 | action | `(ctx) => data`；入参已按 spec 强转/校验 |
| `render` | 否 | action | `(data) => string`；只影响 CLI 输出 |
| `stream` | 否 | action | `true` = 直出流（附件本体等），CLI/HTTP 行为不同 |
| `resource` | 否 | 模块 | 声明 CRUD 资源名，触发五动词完备性检查 |
| `resources` | 否 | 模块 | 多个资源名（集合资源，如 `['todo','group']`） |

- **没有模块级 `view`**：视图归 `src/web/frontend/registry.js`，`tests/unit/registry.test.mjs` 断言后端不出现该字段。
- `http: null` 是合法声明（如 `db` 诊断命令），不是漏写。
- `rest` flag 字段存在，但**当前实现刻意未启用**；装载期仍校验它必须声明在 `flags` 最后。

## 2. Flag 规格

```js
flags: {
  group: { type: 'number', hint: '工作空间 id（默认取当前）' },
  limit: { type: 'number', default: 100 },
  name:  { type: 'string' },
  force: { type: 'boolean' },
  ids:   { type: 'array', hint: '逗号分隔' },      // CLI a,b,c → ['a','b','c']
  mode:  { type: 'string', enum: ['a','b'], default: 'a' },
  note:  { type: 'string', required: true },
}
```

- `type`：`string`（默认）/ `number` / `boolean` / `array`。
- `default` / `hint` / `enum` / `required` 都会参与解析与帮助文本。
- 布尔 flag 不吃下一个 token：`--force demo` 中 `demo` 仍是位置参数。
- 非布尔 flag 后面缺值 → 报错「参数 --x 需要提供值」，**不**静默改义。
- `rest` 未启用：含空格的值请加引号，不要指望吃掉剩余 token。

## 3. CLI 与 HTTP 的一致性

- CLI 的 `--flag` 与 HTTP query/body 共用同一套强转、默认值与校验（`src/runtime/spec.js`）。
- 未声明的键会原样透传（HTTP 可能带界面字段），CLI 不会凭空产生。
- 参数错误是**对外契约**：报错必须以 `用法:` + 完整用法串开头（`inputError` 自动生成）。内置 skill 的 agent 靠这个前缀判断「参数错 → 停下来问人」，不要手写简化报错。
- 平台端点（心跳、SSE、静态资源）不进 action 表，由 `runtime/server.js` 直接处理。

## 4. HTTP 路由形状

- 用 `:param` 占位：`/api/repos/:id`。
- 单条定位允许固定尾段（如 `/api/todo/item`，内容放 body/query，不塞路径）。
- `get/update/remove` 不能与 `list` 同路径，否则路由撞车。
- 前端调 `api('/api/...')`（`api/client.js`），失败抛 `Error` 且带 `.code`。

## 5. CRUD 契约

模块声明 `resource` / `resources` 后，必须五动词齐备且两端可达：

| 动作 | action id | CLI | HTTP | 路由 |
|---|---|---|---|---|
| 列表 | `X.list` | `x list` | GET | 不含 `:param` |
| 单条 | `X.get` | `x get` | GET | 含 `:param` 或固定尾段 |
| 新增 | `X.add` | `x add` | POST | — |
| 修改 | `X.update` | `x update` | PATCH | 含 `:param` 或固定尾段 |
| 删除 | `X.remove` | `x remove` | DELETE | 含 `:param` 或固定尾段 |

`registry.test.mjs` 会逐条断言 id、CLI、路由、方法、形状；只做一半会红。

## 6. 注册期自检（服务一起来就验）

`src/runtime/registry.js` 检查：

1. `id` 重复；
2. action 没有任何 CLI 路径；
3. CLI 路径重复；
4. HTTP 路由重复；
5. `http` 既不是数组也不是显式 `null`；
6. 缺少 `run`；
7. `flags.rest` 不在最后。

`tests/unit/registry.test.mjs` 另外断言：

- 每条 action 都有 `cli`；
- 前端视图声明的 `module` 指向已登记后端模块、视图文件存在；
- 前端源码里的 `/api/...` 字面量都能在后端 action 表中找到；
- 后端模块不出现模块级 `view`。

## 7. 命令 ↔ 路由反查

```powershell
node bin/cli.mjs routes                    # 全量对照
node bin/cli.mjs routes --module localtask # 只看某模块
node bin/cli.mjs routes --http "POST /api/localtasks/preview"
node bin/cli.mjs help --json               # 与 routes 同源同长
```

## 8. 新增/修改 action 的检查清单

1. `service.js` 写业务函数（普通对象入参/返回），事务与 SQL 不进 action。
2. `index.js` 声明 `id` / `cli` / `http` / `summary` / args/flags / `run` / `render`。
3. 需要面板入口：前端 `registry.js` 登记视图，页面里调 `/api/...`。
4. `pnpm lint && pnpm test:unit && pnpm build`。
5. 文档同步：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`；命令口径变了再同步 `assets/`。
