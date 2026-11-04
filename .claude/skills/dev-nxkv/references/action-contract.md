# action 契约 —— 一条声明，三端同源

> 配套 [[dev-nxkv]]。`src/modules/*/index.js` 里的一个 action 对象，就是
> **一条 CLI 命令 + 一条 HTTP 路由 + 一个面板入口**的唯一事实源。
> CLI 的 `--flag` 与 HTTP 的 query/body 走同一套强转与校验（`src/runtime/spec.js`）。

## 字段全表

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 全局唯一，惯例 `<模块>.<动词>`（如 `todo.add`）。重复会在装载期抛错 |
| `cli` | ✅ | 命令路径：`['todo','add']`；别名：`[['a','b'],['c','d']]`。**每条 action 都必须有** |
| `http` | ➖ | `[method, pattern]`（如 `['POST','/api/todo/:id']`）或显式 `null`（纯 CLI）。不能缺、不能是别的形状 |
| `summary` | ✅ | 一句话说明，进 `help` 与面板提示 |
| `args` | ➖ | 位置参数：`['text']` = 必填字符串；对象形式可声明 `{name, required:false}` |
| `flags` | ➖ | 见下 |
| `run` | ✅ | `(ctx) => any` —— ctx 含已校验强转过的 args/flags 与 HTTP 上下文 |
| `render` | ➖ | `(data) => string` —— CLI 输出一行人读文本；HTTP 侧忽略 |
| `view` | ➖ | 模块级字段：`() => import(...)` 惰性入口；`null` 表示没有独立面板 |
| `resource` / `resources` | ➖ | 模块级：声明 CRUD 资源名（`todo`、`group`…），触发五动词完备性检查 |
| `stream` | ➖ | action 级：`true` = 直出流（附件本体之类），CLI 与 HTTP 行为不同 |

## flag 规格

```js
flags: {
  group:  { type: 'number', hint: '工作空间 id（默认取当前）' },
  limit:  { type: 'number', default: 100 },
  name:   { type: 'string' },
  force:  { type: 'boolean' },
  ids:    { type: 'array', hint: '逗号分隔' },      // CLI 传 a,b,c → ['a','b','c']
  mode:   { type: 'string', enum: ['a','b'], default: 'a' },
  note:   { type: 'string', required: true },
}
```

- `type`：`string`（默认）/ `number` / `boolean` / `array`。
- `default`：缺省值；`hint`：帮助文本；`enum`：取值域；`required`：缺了就报错。
- `rest`：吃掉其后全部 token —— **必须声明在 `flags` 的最后**（当前实现里刻意未启用，
  但装载期自检会守住这条约束，将来启用时不用重踩）。
- 布尔 flag 不会吃掉下一个 token：`--force demo` 里 `demo` 是位置参数。
- 非布尔 flag 后面没值 → 报错「参数 --x 需要提供值」，**不**把笔误静默变成别的语义。

## 参数错误是「对外契约」

缺参数 / 取值非法时，报错文本必须带 **`用法:` + 完整用法串**
（`spec.js` 的 `inputError` 自动生成）。资产里的 agent 工作流文档教 agent 用这个前缀
判定「参数错误 → 停下来问人」，所以别手写简化报错。

## HTTP 路由

- pattern 用 `:param` 占位：`/api/repos/:id`。
- 单条定位允许固定尾段（如 `/api/todo/item`，内容放 body/query，不塞进路径）。
- 请求体：前端 `api(path, {method, body})` → JSON；后端 `run` 收到的 ctx 已按声明校验。
- 平台端点（心跳、SSE）不进 action 表，由 `runtime/server.js` 直接处理。

## CRUD 契约（声明了 `resource` 就有义务齐备）

资源 `X` 承诺五个动作，且**两端都可调用**：

| 动作 | action id | CLI | HTTP 方法 | 路由形状 |
| --- | --- | --- | --- | --- |
| 查（列表） | `X.list` | `x list` | GET | 不含 `:param` |
| 查（单条） | `X.get` | `x get` | GET | 含 `:param` 或固定定位尾段 |
| 增 | `X.add` | `x add` | POST | — |
| 改 | `X.update` | `x update` | PATCH | 含 `:param` 或固定定位尾段 |
| 删 | `X.remove` | `x remove` | DELETE | 含 `:param` 或固定定位尾段 |

`get/update/remove` 的路径**不能**与 `list` 同路径（否则两条路由撞车）。
`tests/unit/registry.test.mjs` 会逐条断言 id、CLI、路由、方法、形状。

## 装载期自检（`src/runtime/registry.js` 顶部）

服务一起来就会验，**不等用户敲到那条命令**：

- action id 重复 → 抛错
- 同一 CLI 路径被两个 action 声明 → 抛错
- 同一 HTTP 路由重复 → 抛错
- action 没有 `cli` → 抛错（保证「面板能做的，CLI 都能做」）
- `http` 既不是数组也不是 `null` → 抛错
- action 没有 `run` → 抛错
- `rest` flag 不在最后 → 抛错

## 命令 ↔ 路由的双向反查

```bash
nx-kv routes                      # 全量对照表（命令 ↔ 路由）
nx-kv routes --module localtask   # 只看某模块（工作空间命令归 todo 模块，别拿它举例）
nx-kv routes --http "POST /api/todo"   # 从端点反查命令（agent 常用：面板 devtools 看到请求 → 怎么用 CLI 重放）
nx-kv help --json                 # 与 routes 同源同长（测试断言两者一致）
```

## 新增一条 action 的清单

1. `service.js` 里写业务函数（入参普通对象，返回普通对象）
2. `index.js` 里加 action：`id` / `cli` / `http` / `summary` / `flags` / `run` / `render`
3. 需要面板入口 → 前端 `registry.js` 登记 `VIEWS`；已有面板里加按钮即可
4. `pnpm run lint && pnpm run build && pnpm test`
5. 文档同步：`docs/project&projectsCli.md`、`CHANGELOG.md`；命令变了还要改 `assets/` 里的用法串——对应 skill 的 `SKILL.md` 与 `references/*.md`（新增 / 删除内置 skill 还要同步 `assets/groups.json`，见主文档「assets/」一节）
