# B03 · action 契约：声明形状、参数、校验

> B 序列 · 架构之三。回答「一条 action 怎么写、CLI 与 HTTP 怎么保持一致、什么会被测试拦住」。
> 全量入口清单见 [[B02-action注册全表]]。

## 0. 两种声明形态（迁移期并存）

| 形态 | 位置 | 契约 | 适用 |
|---|---|---|---|
| **legacy** | `src/modules/<id>/index.js`（plain-object） | `flags` 表 + `applySpec` 强转 | 存量模块（11 个），只维护不扩张 |
| **模板形态** | `src/modules/<id>/index.ts`（ModuleBase 子类）+ `actions/<名>.ts` | **zod schema 即契约**（`@action` 装饰器 + `ActionBase<TInput>` 泛型模板） | 新增 / 正在迁移的模块（`system` 已迁移） |

两通道由 `runtime/registry.ts` 的 Registry 同时装载，`runtime/cli.ts`（CliApp）与
`runtime/api.ts`（ApiRouter）对通道无感：

- legacy：token 扫描 → `applySpec`（flags 表强转 + 必填/枚举校验）
- zod 通道：token 扫描 → `normalizeCliValue` 归一化 → `parseZodInput`（zod 校验）

**新 action 一律走模板形态**；一条 action 一个文件 `actions/<名>.ts`，
**契约（zod schema）就声明在该文件里**（#178 起不再有独立的 `schemas.ts`），
类清单由 `pnpm gen:actions` 扫目录生成到 `actions/_manifest.generated.ts`——
**模块 index.ts 不手工列举 action**（加一条 action = 新建一个文件 + 跑一次 `pnpm gen`）。

## 0.5 模板形态的一条 action（泛型模板版）

```ts
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';

/** x.do 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().optional().describe('编号'),
});

export class XAction extends ActionBase<typeof input> {
  @action({
    id: 'x.do',
    cli: ['x', 'do'],
    http: ['POST', '/api/x'],
    summary: '一句话说明',
    input,                  // 运行期契约（zod 校验 + codegen 取字段）
  })
  override async run(ctx: ActionInput<this['_input']>) {
    // ctx 的类型由基类泛型推出来：z.output<typeof input>
    return this.deps.get('config');
  }
}
```

| 约定 | 说明 |
|---|---|
| **契约内联、名为 `input`** | 一文件一契约；schema 内容逐字保留（`.describe()` 是 CLI 用法串与 help 文案的来源） |
| **方法名固定 `run`** | 只有 override 基类方法才能拿到泛型；分方法名（`get`/`list`…）会让基类模板失效 |
| **注解 `ActionInput<this['_input']>`** | 全项目统一样板；类型从类上的 `TInput` 推导，schema 只声明一次 |
| **`extends ActionBase<typeof input>`** | 入参类型的唯一声明点（编译期）；`meta.input` 是它的运行期镜像 |
| **第二参 `opts: ActionRunMeta = {}`** | 只有读 `transport` 的 action 才需要（`opts.transport === 'http'`） |
| **`@action` 只收元数据** | 装饰器不改方法签名、不做类型对账（this 依赖类型出了类声明不可解析） |

**为什么注解不能省**：TS 对类成员声明**没有任何**上下文类型注入通路——
override 不从基类取参数类型，TC39 装饰器也不给被标方法做推断（都实测过）。
`this['_input']` 幻影字段是「注解可写、schema 不重述」的唯一通路。

**前端怎么拿到入参类型**：codegen 从 **action 类**反推
（`z.input<InstanceType<typeof XAction>['_input']>`）——契约常量是文件内的实现细节，
不再跨文件被引用，也不再有 `<camelCase(actionId)>Input` 命名约定。

**改动这类文件时的红线**：注解不许退回 `ctx: any`、也不许手写 `z.output<typeof …>`
（后者会让 schema 声明点分裂到两处）。类型报错先看是不是 schema 与 handler 真的错位
——#177 正是靠它抓出 6 处「读未声明键」的死路径。

## 1. 一条 action 的形状（legacy 形态）

```js
{
  id: 'localtask.preview',                    // 全局唯一，<module>.<verb>
  cli: ['localtask', 'preview'],              // 必有；可为多路径别名
  http: ['POST', '/api/localtasks/preview'],  // 可选；纯 CLI 写 null
  summary: '一句话说人话',                     // help / routes / 面板提示
  args: ['id'],                               // 位置参数；字符串=必填，对象可 optional
  flags: {
    id: { type: 'number', hint: '任务编号' },
    text: { type: 'string', hint: '草稿正文' },
  },
  run: async (ctx) => service.preview(ctx),  // 只编排，不写业务
  render: (data) => '人读文本',                 // CLI 输出；HTTP 忽略
}
```

### 字段全表

| 字段 | 必填 | 位置 | 说明 |
|---|---|---|---|
| `id` | 是 | action | 全局唯一；重复在启动时抛错 |
| `cli` | 是 | action | 路径数组；别名写作 `[['a','b'],['c','d']]`；没有 `cli` 直接失败 |
| `http` | 是 | action | `[METHOD, '/api/...']` 或**显式** `null`；不能缺、不能是别的形状 |
| `summary` | 建议 | action | `help --json` / `routes` / 面板展示 |
| `args` | 否 | action | 字符串 = 必填位置参数；`{ name, required: false }` 可选 |
| `flags` | 否 | action | 见下 |
| `run` | 是 | action | `(ctx) => data`；入参已按 spec 强转 / 校验 |
| `render` | 否 | action | `(data) => string`；只影响 CLI 输出 |
| `stream` | 否 | action | `true` = 直出流（附件本体、SSE 等），CLI / HTTP 行为不同 |
| `resource` | 否 | 模块 | 声明 CRUD 资源名，触发五动词完备性检查 |
| `resources` | 否 | 模块 | 多个资源名（集合资源，如 `['todo','group']`） |

- **没有模块级 `view`**：视图归 `src/web/frontend/registry.js`，`tests/unit/registry.test.mjs` 断言后端不出现该字段。
- `http: null` 是合法声明（如 `db` 诊断命令），不是漏写。
- `rest` flag 字段存在，但**当前实现刻意未启用**；装载期仍校验它必须声明在 `flags` 最后。理由：rest 能让 `--ref 修复登录页 500` 不加引号传整句，但必须置尾，于是没法与 `--pick` 组合——而「同内容多条 → 用 `--pick` 消歧」正是最需要 ref 的场景。消歧能力比少打一对引号重要，所以 ref 走普通 flag（值带空格时加引号）。

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

| type | 行为 |
|---|---|
| `string` | 默认类型 |
| `number` | `Number(raw)`，非有限数报错 |
| `boolean` | `false` / `0` / `no` / `''` 视为 false，其余为 true |
| `array` | 逗号分隔；**直接给数组时原样透传** |
| `raw` | **原样透传，不做字符串化**——给「值本身是数组/对象」的 flag 用（模板可见域 `scope` 就是这种：JSON 数组串、逗号短写、HTTP 直接发数组，三种形态都要活着走到 action 里）。走 `string` 会被 `String([])` 压成 `''`，「清空可见域」就变成「不传」，静默吞掉一次写入 |

其他字段：

- `default` / `hint` / `enum` / `required` 都参与解析与帮助文本生成。
- 布尔 flag **不吃下一个 token**：`--force demo` 中 `demo` 仍是位置参数。
- 非布尔 flag 后面缺值 → 报「参数 --x 需要提供值」，**不**静默改义（`Number(true) === 1` 会变成另一个合法值）。
- `enum` 不匹配 → 报错并列出合法取值。

## 3. CLI 与 HTTP 的一致性

- CLI 的 `--flag` 与 HTTP 的 query/body **共用同一套**强转、默认值与校验（`src/runtime/spec.ts` 的 `applySpec`）。
- 未声明的键原样透传（HTTP body 可能带界面用的额外字段）；CLI 不会凭空产生。
- **参数错误是对外契约**：报错必须以 `用法:` + 完整用法串开头（`spec.js` 的 `inputError` 自动生成）。内置 skill 的 agent 靠这个前缀判断「参数错 → 停下来问人」，不要手写简化报错。
- 用法串由声明反推（`usageOf`），所以 `help` 不可能与实际命令脱节；`--flag` 的占位符优先用 `enum` 展开，其次 `hint`，最后才退回 flag 名。

## 4. HTTP 路由形状

- 占位用 `:param`：`/api/repos/:id`。
- 单条定位允许固定尾段（如 `/api/todo/item`、`/api/docs/item`，内容放 body/query，不塞路径）。
- `get` / `update` / `remove` 不能与 `list` 同路径，否则路由撞车。
- **字面量段优先于参数段**：`GET /api/repos/status` 与 `GET /api/repos/:id` 都能匹配 `/api/repos/status`。`api.js` 编译后按「字面量在前、段数多的在前」排序，**声明顺序不再影响匹配结果**。反过来看，静态路由必须自己按载荷分派——`PATCH /api/templates/default` 若被 `:id` 抢走，`id=default` 的模板就存不进去。`routes` 命令的 `--http` 反查也按同一套段对段规则。
- 前端调 `api('/api/...')`（`src/web/frontend/api/client.js`），失败抛 `Error` 且带 `.code`。

## 5. CRUD 契约

模块声明 `resource` / `resources` 后，必须五动词齐备且两端可达：

| 动作 | action id | CLI | HTTP | 路由 |
|---|---|---|---|---|
| 列表 | `X.list` | `x list` | GET | 不含 `:param` |
| 单条 | `X.get` | `x get` | GET | 含 `:param` 或固定尾段 |
| 新增 | `X.add` | `x add` | POST | — |
| 修改 | `X.update` | `x update` | PATCH | 含 `:param` 或固定尾段 |
| 删除 | `X.remove` | `x remove` | DELETE | 含 `:param` 或固定尾段 |

`tests/unit/registry.test.mjs` 会逐条断言 id、CLI、路由、方法、形状；只做一半会红。

当前声明了 resource 的模块：`repos`（`repo`）、`docs`（`doc`）、`localtask`（`localtask`）、`todo`（`todo`）。

## 6. 两层校验

### 装载期（`src/runtime/registry.ts`）

见 [[B02-action注册全表]] §4 的 7 条。

### 测试期（`tests/unit/registry.test.mjs`）

额外断言：

- 每条 action 都有 `cli`；
- 前端视图声明的 `module` 指向**已登记**的后端模块，且视图文件真实存在；
- 前端源码里的 `/api/...` 字面量都能在后端 action 表中找到（前端调了不存在的路由 → 红）；
- 后端模块**不出现**模块级 `view`；
- 声明了 `resource` 的模块五动词齐备。

## 7. CLI 侧的命令匹配

`src/runtime/cli.ts` 的 `resolveCommand`：把声明路径与 argv 前缀**逐 token** 比较，选**最长匹配**。

- 逐 token 比对是必需的——有些命令路径本身就含 flag（`skill install --list` 是「列出内置包」而非「安装」）。
- 最长优先让 `['skill','central','add']` 压过 `['skill','central']`，子命令与别名因此共存。
- 「像 flag」的 token 只认 `--` 后跟字母/数字：`---` 开头的是**正文**（markdown frontmatter / 分隔线），`--` 是「后面全是位置参数」的约定。任务正文以 frontmatter 开头时（`localtask add "--- board: …"`）正需要这条，否则会被当成未知参数报错。

## 8. 新增 / 修改 action 的检查清单

1. `service.js` 写业务函数（普通对象入参 / 返回），事务与 SQL 不进 action。
2. `index.js` 声明 `id` / `cli` / `http` / `summary` / args / flags / `run` / `render`。
   （模板形态：`actions/<名>.ts` 一个文件一条 action，契约 zod 内联在该文件、
   `extends ActionBase<typeof input>` + `override run(ctx: ActionInput<this['_input']>)`
   ——见 §0.5）
3. `id` 命名 `<module>.<verb>`，全局唯一；CLI 路径不得与现有命令重复。
4. 需要面板入口：前端 `registry.js` 登记视图，页面里调 `/api/...`。
5. `pnpm lint && pnpm test:unit && pnpm build`。
6. 文档同步：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`；命令口径变了再同步 `assets/`。
