# B03 · action 契约：声明形状、参数、校验

> B 序列 · 架构之三。回答「一条 action 怎么写、CLI 与 HTTP 怎么保持一致、什么会被测试拦住」。
> 全量入口清单见 [[B02-action注册全表]]。

## 0. 一种形态：模板（全部业务模块）

**全部 12 个业务模块都已是模板形态**：`ModuleBase` 子类 + `actions/<名>.ts`
（`@action` 装饰器 + `ActionBase<TInput>` 泛型基类 + **zod schema 即契约**）。
legacy flags 表契约（`spec.ts` 的 `applySpec`）只剩 **runtime 内建命令**（serve / help / version）在用，
业务模块不扩张——不要在业务代码里再写 flags 表。

`runtime/cli.ts`（CliApp）与 `runtime/api.ts`（ApiRouter）对通道无感：

- zod 通道：token 扫描 → `normalizeCliValue` 归一化 → `parseZodInput`（zod 校验）
- legacy 通道（内建命令）：token 扫描 → `applySpec`（flags 表强转 + 必填/枚举校验）

一条 action 一个文件 `actions/<名>.ts`，**契约（zod schema）就声明在该文件里**
（#178 起不再有独立的 `schemas.ts`），类清单由 `pnpm gen:actions` 扫目录生成到
`actions/_manifest.generated.ts`——**模块 index.ts 不手工列举 action**
（加一条 action = 新建一个文件 + 跑一次 `pnpm gen`）。

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
| **契约内联、名为 `input`** | 一文件一契约；schema 内容逐字保留（`.describe()` 是 CLI 用法串与 help 文案的来源，动了就改口径） |
| **方法名固定 `run`** | 只有 override 基类方法才能拿到泛型；分方法名（`get`/`list`…）会让基类模板失效（`client.generated.ts` 的类型锚点也认 `run`） |
| **注解 `ActionInput<this['_input']>`** | 全项目统一样板；类型从类上的 `TInput` 推导，schema 只声明一次 |
| **`extends ActionBase<typeof input>`** | 入参类型的唯一声明点（编译期）；`meta.input` 是它的运行期镜像 |
| **第二参 `opts: ActionRunMeta = {}`** | 只有读 `transport` 的 action 才需要（`opts.transport === 'http'`；例：`localtask.claim` HTTP 不阻塞、不开浏览器） |
| **`@action` 只收元数据** | 装饰器不改方法签名、不做类型对账（this 依赖类型出了类声明不可解析）；`meta.input` 与 `TInput` 不一致编译期即红 |
| **id 与 CLI 动词可不同名** | `localtask.claim` 的 cli 是 `['localtask','get']`、`localtask.get` 的 cli 是 `['localtask','show']`——id 全局唯一即可，对外动词按用户心智 |

**为什么注解不能省**：TS 对类成员声明**没有任何**上下文类型注入通路——
override 不从基类取参数类型，TC39 装饰器也不给被标方法做推断（都实测过）。
`this['_input']` 幻影字段是「注解可写、schema 不重述」的唯一通路。

**出参没有模板——实现即契约**：返回类型由实现推断，codegen 直接从方法签名读。

**前端怎么拿到入参类型**：codegen 从 **action 类**反推
（`z.input<InstanceType<typeof XAction>['_input']>`）——契约常量是文件内的实现细节，
不再跨文件被引用，也没有 `<camelCase(actionId)>Input` 命名约定（#178 已删）。

**改动这类文件时的红线**：注解不许退回 `ctx: any`、也不许手写 `z.output<typeof …>`
（后者会让 schema 声明点分裂到两处）。类型报错先看是不是 schema 与 handler 真的错位
——#177 正是靠它抓出 6 处「读未声明键」的死路径（zod 会剥掉未声明键，读了恒为 undefined）。

**迁移器产物的过渡形态别模仿**：存量 action 里还有 `const service: any = serviceNs;`、
局部 `as any` cast（从 legacy JS 机械迁移来的）。新写 action 直接用严格类型；
碰到旧文件顺手类型化是加分项，不是必须。

## 1. zod 契约的可用字段形态

schema 是标准 zod；`.describe()` 参与用法串与 help。zod-bridge 从 schema 内部结构反推每个字段
的「CLI 形态」（`FieldKind`）：

| kind | 对应 schema | CLI 行为 |
|---|---|---|
| `string` | `z.string()` | 默认 |
| `number` | `z.number()` | `Number(raw)`，非有限数报错 |
| `boolean` | `z.boolean()` | `false`/`0`/`no`/`''` 视为 false，其余为 true；**布尔 flag 不吃下一个 token** |
| `enum` | `z.enum([...])` | 不匹配 → 报错并列出合法取值 |
| `array` | `z.array(z.string())` | 逗号分隔（`a,b,c` → `['a','b','c']`）；HTTP 直接给数组原样透传 |
| `kv` | kv 键值对 | `--set k=v`；多值可重复或逗号分隔 |
| `raw` | 声明为 raw 的字段 | **原样透传，不做字符串化、也不 JSON.parse**——给「值本身是数组/对象」的字段用（模板可见域 `scope` 就是这种：JSON 数组串、逗号短写、HTTP 直接发数组，三种形态都要活着走到 action 里） |

为什么不用 `z.coerce`：`z.coerce.boolean()` 把字符串 `'false'` 变 true、`z.coerce.number()`
把空串变 0——都与既有 CLI 语义冲突，归一化必须自己写（`zod-bridge.ts` 读 `_zod.def.type`
内部 API，**zod 升级先看这里**）。

其他规则：

- 布尔 flag **不吃下一个 token**：`--force demo` 中 `demo` 仍是位置参数。
- 非布尔 flag 后面缺值 → 报「参数 --x 需要提供值」，**不**静默改义（`Number(true) === 1` 会变成另一个合法值）。
- `optional()` + `.default()` 参与必填判定与用法串。
- **zod 校验会剥掉未声明的键**：HTTP body 里多带的字段到不了 `run`。action 需要某字段就必须在 schema 里声明——「先透传后读」的旧习惯在 zod 通道下是死路径。

## 2. CLI 与 HTTP 的一致性

- CLI 的 `--flag` 与 HTTP 的 query/body **共用同一份** schema：`zod-bridge.ts` 先把 argv / query
  归一成 schema 期待的形状，再 `parseZodInput` 校验。归一化是**代码**（随 schema 变化自动跟随），校验是 schema。
- **参数错误是对外契约**：报错必须以 `用法:` + 完整用法串开头（`usageOf` 自动生成）。内置 skill 的 agent 靠这个前缀判断「参数错 → 停下来问人」，不要手写简化报错。
- 用法串由声明反推，所以 `help` 不可能与实际命令脱节；`--flag` 的占位符优先用 `enum` 展开，其次 `.describe()`，最后退回字段名。

## 3. HTTP 路由形状

- 占位用 `:param`：`/api/repos/:id`。
- 单条定位允许固定尾段（如 `/api/todo/item`、`/api/docs/item`，内容放 body/query，不塞路径）。
- `get` / `update` / `remove` 不能与 `list` 同路径，否则路由撞车。
- **字面量段优先于参数段**：`GET /api/repos/status` 与 `GET /api/repos/:id` 都能匹配 `/api/repos/status`。`api.ts` 编译后按「字面量在前、段数多的在前」排序，**声明顺序不再影响匹配结果**。反过来看，静态路由必须自己按载荷分派——`PATCH /api/templates/default` 若被 `:id` 抢走，`id=default` 的模板就存不进去。`routes` 命令的 `--http` 反查也按同一套段对段规则。
- 前端调 `api('/api/...')`（`src/web/frontend/api/client.ts`），失败抛 `Error` 且带 `.code`；页面组件不许裸调，收口到本页 `api.ts`（见 [[D02-页面与组件关系]]）。
- `stream` action（SSE / 附件本体）在 HTTP 下拿 `ctx.__raw`（`req/res/url`）自己接管响应；CLI 下走 NDJSON / 直出。

## 4. CRUD 契约

模块在 `index.ts` 声明 `resource` / `resources` 后，必须五动词齐备且两端可达：

| 动作 | action id | CLI | HTTP | 路由 |
|---|---|---|---|---|
| 列表 | `X.list` | `x list` | GET | 不含 `:param` |
| 单条 | `X.get` | `x get` | GET | 含 `:param` 或固定尾段 |
| 新增 | `X.add` | `x add` | POST | — |
| 修改 | `X.update` | `x update` | PATCH | 含 `:param` 或固定尾段 |
| 删除 | `X.remove` | `x remove` | DELETE | 含 `:param` 或固定尾段 |

`tests/unit/registry.test.mjs` 会逐条断言 id、CLI、路由、方法、形状；只做一半会红。

当前声明了 resource 的模块：`repos`（`repo`）、`docs`（`doc`）、`localtask`（`localtask`）、`todo`（`todo`，另有 `resources: ['todo','group']`）。

## 5. 两层校验

### 装载期（`src/runtime/registry.ts`）

见 [[B02-action注册全表]] §4 的 7 条。

### 测试期（`tests/unit/registry.test.mjs`）

额外断言：

- 每条 action 都有 `cli`；
- 前端视图声明的 `module` 指向**已登记**的后端模块（两侧模块集合对账），且视图文件真实存在；
- 前端源码里的 `/api/...` 字面量都能在后端 action 表中找到（前端调了不存在的路由 → 红）；
- 后端模块**不出现**模块级 `view`；
- 声明了 `resource` 的模块五动词齐备。

## 6. CLI 侧的命令匹配

`src/runtime/cli.ts` 的 `resolveCommand`：把声明路径与 argv 前缀**逐 token** 比较，选**最长匹配**。

- 逐 token 比对是必需的——有些命令路径本身就含 flag（`skill install --list` 是「列出内置包」而非「安装」）。
- 最长优先让 `['skill','central','add']` 压过 `['skill','central']`，子命令与别名因此共存。
- 「像 flag」的 token 只认 `--` 后跟字母/数字：`---` 开头的是**正文**（markdown frontmatter / 分隔线），`--` 是「后面全是位置参数」的约定。任务正文以 frontmatter 开头时（`localtask add "--- board: …"`）正需要这条，否则会被当成未知参数报错。

## 7. 新增 / 修改 action 的检查清单

1. `service.ts` 写业务函数（普通对象入参 / 返回），事务与 SQL 不进 action。
2. 新建 `actions/<名>.ts`：契约 zod 内联（`input`）、`extends ActionBase<typeof input>` +
   `override run(ctx: ActionInput<this['_input']>)`（样板见 §0.5）。
3. `id` 命名 `<module>.<verb>`，全局唯一；CLI 路径不得与现有命令重复。
4. 跑 `pnpm gen`（清单 + typed client + cli-tree 刷新）；改了 action 声明后 **serve 要重启**才生效。
5. 需要面板入口：前端在本页 `api.ts` 加函数、组件里消费（不要裸调 `api()`）。
6. `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build`。
7. 文档同步：`README.md`、`docs/project&projectsCli.md`、`CHANGELOG.md`；命令口径变了再同步 `assets/`。
