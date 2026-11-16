# 提示词插件：唯一基准方案

> **本文件是唯一基准。** 不含备选路线、不含兼容层、不含「可选开关」。
> 与当前实现冲突处，一律按本文件改写；旧形态在 S1 里**删除**，不保留双跑。
> 结论来自历史轮次验收：`get` 双态（文本态 / 结构态）、父类强制 `order`、单一路线、
> `order` 可在 UI 拖动、默认模板为 JSON 资产并在 `npx` 首启落库、
> schema 用 zod 声明（第 11 轮）。

---

## 0. 一条路线

```
src/modules/promptplug/Template/blockTemplates.json   出厂快照（与 DB 行逐字同形）
        │ ensure.ts：首启 / 版本落后才写
        ▼
settings['lt.blockTemplates']      模板唯一真相（8 段，每段 active + list）
settings['prompt.pluginOrder']     顺序唯一真相（id 数组）
        │
        ▼
PromptPlugin 基类（get() 文本 / get('data') 结构）
        │ compose.ts：按数组顺序取数 → 合并 ctx → 逐段渲染
        ▼
<nx-kv> … </nx-kv>                  交付给 agent 的 instruction
        │
        └─ uiDescriptor()：同一份 schema → 设置界面 / CLI / HTTP API
```

五条铁律，任何一条破了都等于又开第二条路线：

1. **一个插件 = 一段输出 = 一个 order 位 = 一组写回键**，四者一一对应，不许多也不许少。
2. **模板数据只存在 DB**：bundle 只负责首次播种与升级，运行期不读 bundle。
3. **顺序只存在数组**：代码里的 `order` 只是播种默认位，运行期一律由数组派生。
4. **运行期不兜底**：模板语法与变量白名单在保存期校验，插件契约在启动期校验，运行期是一条直线。
5. **声明是 UI 的唯一数据源**：界面、CLI、API 三端都从 `schema` 派生，不写第二份。

---

## 1. 插件契约

```ts
// src/shared/prompt-plugin.ts —— 纯类型 + 纯函数，Node 与浏览器同一份
// （shared 零依赖红线，zod 进不了这里；PluginSchema 是「派生输出」的形状，
//  不再由插件作者手写——见 §1.4）
export type FieldKind = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'list';

export interface FieldDecl {
  key: string;              // 完整 ctx 路径：'task.id' / 'attach.count' / 'repo.docs'
  kind: FieldKind;
  label: string;
  desc?: string;
  enumValues?: readonly string[];
}

export interface PluginSchema<TData> {
  /** 本段模板**可见**的变量全集：模板变量白名单、UI「插入变量」目录都来自这里 */
  fields: readonly FieldDecl[];
  /** 未取数时的占位（UI 初值，零 I/O） */
  blank: TData;
}

/** 注册面：注册表 / compose / uiDescriptor 只认这一层 */
export interface AnyPromptPlugin {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  readonly writes: readonly string[];      // 写回的 ctx 顶层段（[] = 只读段）
  readonly schema: PluginSchema<unknown>;
  get(): string;
  get(as: 'data'): Promise<unknown>;
}
```

```ts
// src/modules/promptplug/base.ts
import { z } from 'zod';
import type { AnyPromptPlugin } from '../../shared/prompt-plugin.js';

export abstract class PromptPlugin<S extends z.ZodObject<z.ZodRawShape>>
  implements AnyPromptPlugin {

  abstract readonly id: string;
  /** ★ 父类强制：子类漏写编译不过（TS2515）。值只是播种默认位，运行期由数组派生 */
  abstract readonly order: number;
  abstract readonly label: string;
  /** ★ data 形状用 zod strictObject 声明一次，TData 由它推导，不双写（§1.4） */
  abstract readonly schema: S;
  /** 默认只读：只读段不写 ctx（timecheck / goalhint / doneguard / ack） */
  readonly writes: readonly string[] = [];

  /** 子类只写这两处 */
  protected abstract template(): string;
  protected abstract data(): Promise<z.infer<S>> | z.infer<S>;

  /** 唯一出口：无参 = 文本态；传 'data' = 结构态（校验只在这里发生一次） */
  get<T extends z.infer<S> = z.infer<S>>(as: 'data'): Promise<T>;
  get(): string;
  get(as?: 'data'): string | Promise<z.infer<S>> {
    if (as !== 'data') return this.template();
    return Promise.resolve(this.data()).then((raw) => {
      const r = this.schema.safeParse(raw);
      if (!r.success) {
        const issues = r.error.issues.map((i) => `${i.path.join('.') || '(根)'} ${i.message}`).join('；');
        throw new Error(`${this.id}: data() 返回与 schema 不符——${issues}`);
      }
      return r.data;
    });
  }
}
```

### 1.1 `get` 的双态

| | `p.get()` | `await p.get('data')` |
|---|---|---|
| 返回 | `string`，模板原文（含 `{{…}}`） | `TData`，数据对象 |
| 同步性 | 同步（模板来自 DB 缓存） | 异步（要读 SQLite） |
| 消费方 | 渲染器、模板编辑器初值、预览 | ctx 合并、参数表单初值、单测断言 |
| 每个插件几份 | 1 份 | 1 份 |

判别靠**运行时可见的字面量 `'data'`**，不靠泛型——泛型在运行时被擦除。泛型只负责把结构态返回值收窄到 `T`。
子类不得重写 `get`：出口只有一个，「怎么取」全仓只有一处答案。

### 1.2 `schema` 与 `writes` 的关系（一条不变量）

`schema.fields` 是**可读集合**，`writes` 是**可写集合**，规则只有一条：

```
writes ⊆ schema 的顶层段（zod shape 的一级键）
```

- 读 seed（`task` / `cwd` / `goal`）的段把变量写进 `fields`，`writes` 留空；
- 自己取数写回 ctx 的段，`writes` 列出它写回的顶层段，`data()` 返回的键必须落在这个集合里——现在由 zod `strictObject` 在 `get('data')` 出口强制（§1.4）。
- 于是「模板变量白名单」与「ctx 合并范围」出自同一份声明，不可能漂移。

### 1.3 启动期校验（唯一一道，`assertPluginList`）

```ts
export function assertPluginList(list: readonly AnyPromptPlugin[]): void {
  const ids = new Set<string>(), orders = new Set<number>(), keys = new Map<string, string>();
  for (const p of list) {
    if (ids.has(p.id)) throw new Error(`插件 id 重复：${p.id}`);
    if (!Number.isInteger(p.order) || p.order <= 0) throw new Error(`${p.id}: order 必须是正整数`);
    if (orders.has(p.order)) throw new Error(`order 冲突：${p.id}`);
    if (!p.get().trim()) throw new Error(`${p.id}: 模板不能为空（空模板 = 该段永不输出，属配置错误）`);
    const own = new Set(p.schema.fields.map((f) => f.key.split('.')[0]!));
    for (const w of p.writes) {
      if (!own.has(w)) throw new Error(`${p.id}: writes 含未在 schema.fields 声明的段 ${w}`);
      const holder = keys.get(w);
      if (holder) throw new Error(`ctx 段 ${w} 被 ${holder} 与 ${p.id} 同时写回`);
      keys.set(w, p.id);
    }
    ids.add(p.id);
    orders.add(p.order);
  }
}
```

四条断言各自挡掉一个真实事故：id 重复（后者覆盖前者）、order 相等（排序退化成数组位置，等于隐式第二条路）、空模板（段静默消失）、ctx 段撞车（谁覆盖谁取决于执行顺序）。`assertPluginList` 收的仍是**纯数据**注册面（`AnyPromptPlugin`），zod 在它之前已被 schema-bridge 折算完（§1.4）。

### 1.4 schema 书写层：靠 zod 做映射（第 11 轮裁决）

**结论：能，且本仓已经用同款模式验证过。** action 层就是先例：每个 action 在自己的文件里声明 `const input = z.object({...})`，入参类型由基类泛型推导（`ActionBase<typeof input>`，`src/modules/localtask/actions/localtask-add.ts:40` 一带），CLI 归一化与出参类型树由 `runtime/zod-bridge.ts` 从 schema 反推。提示词插件的 `schema` 沿用同一套：

| 映射 | zod 提供 | 落点 |
|---|---|---|
| `TData` 类型 | `z.infer<S>`（基类泛型推导，不再双写） | `base.ts` |
| data 结构校验 | `schema.safeParse()`，在 `get('data')` 唯一出口发生 | `base.ts` |
| 顶层段 = `writes` 对账面 | `Object.keys(schema.shape)` | `schema-bridge.ts` |
| `fields`（变量目录 / UI 控件） | shape 递归下钻：`ZodString→string`、`ZodNumber→number`、`ZodBoolean→boolean`、`ZodEnum→enum`（值取自 entries）、`ZodArray→list`、字符串 + `meta({multiline:true})→text` | `schema-bridge.ts` |
| label / desc | `.meta({ title, description })`（`.describe()` 亦可，取 description） | `schema-bridge.ts` |
| `blank`（零 I/O 占位） | 字段全部声明 `.default(...)` 后 `schema.parse({})` | `schema-bridge.ts` |

三条边界，一条都不许破：

1. **zod 只活在 `src/modules/promptplug/`**（`base.ts` / `plugins/*.ts` / `schema-bridge.ts`）。shared 零依赖红线（`eslint.config.js:213-220`：碰第三方包就进不了 Node 包）意味着 `shared/prompt-plugin.ts` 保持纯类型；注册面 `AnyPromptPlugin.schema` 收的是 bridge 折算后的 `PluginSchema<unknown>`，前端经 `/api` 拿到的更是纯 JSON——**zod 是书写层 + 校验层，注册面与三端契约仍是纯数据**（与 contract.json IR 同一裁决：「生成器只认它、不再碰 zod」）。
2. **必须 `z.strictObject`，不是 `z.object`**。zod 默认 strip 未声明键：`data()` 多写了一个顶层段会被静默删掉，`assertPluginList` 的 ctx 撞车校验就永远拦不住、模板变量白名单也对不上账。strictObject 让「多写的键」在出口处显式报错——把 zod 的宽容关掉，校验语义才和不变量一致。
3. **插件 data() 无需归一化层**。`zod-bridge.ts` 头注释的核心教训是「zod 能替代校验，替代不了归一化」（CLI argv / HTTP query 里一切都是字符串）；而插件 `data()` 是仓内代码产出、直接就是结构化对象，没有字符串归一化问题——比 action 场景更干净，这正是插件侧可以用 zod 更省事的原因。

插件书写形态（`plugins/ext.ts`，其余 7 个同款）：

```ts
const schema = z.strictObject({
  topic: z.string().meta({ title: '队列名' }),
  count: z.number().meta({ title: '待领取条数' }),
  list:  z.array(z.object({ id: z.number(), title: z.string() })).meta({ title: '待领取清单' }),
});

export class ExtPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'ext';
  readonly order = 60;            // 播种默认位，运行期由数组派生
  readonly label = '待领取队列';
  readonly writes = ['ext'];
  readonly schema = schema;
  protected data() { /* 现有 ext ctx 聚合逻辑搬进来 */ }
}
```

`get` 双态的运行时判别不受影响：判别仍靠字面量 `'data'`（泛型擦除的老结论不变），zod schema 是运行时对象、不是类型魔法，它改变的是「类型从哪来」和「出口在哪校验」，不改变「怎么取」。

升级警戒：bridge 从 shape 读 `_zod.def` 属 zod 内部 API——本仓已有两处同款先例（`runtime/zod-bridge.ts:44` 的 `unwrap`、`runtime/codegen.ts:162`），zod 升级先看这三处。

---

## 2. 模板资产：`Template/blockTemplates.json`

**位置**：`src/modules/promptplug/Template/blockTemplates.json`（按验收指定的 `module/Template`）。

**形状**：与 `settings['lt.blockTemplates']` 的 value **逐字同形**，落库 = `JSON.stringify(整个文件)`，中间没有转换层。

```json
{
  "context": {
    "active": "builtin",
    "list": [
      { "id": "builtin", "name": "系统内置", "builtin": true, "template": "{{#if repo}}\n{{#if repo.intro}}\n〔项目介绍 · {{repo.name}}〕\n…" }
    ]
  },
  "attachment": { "active": "builtin", "list": [ { "id": "builtin", "name": "系统内置", "builtin": true, "template": "…" } ] },
  "timecheck":  { "active": "builtin", "list": [ … ] },
  "goalhint":   { "active": "builtin", "list": [ … ] },
  "doneguard":  { "active": "builtin", "list": [ … ] },
  "ext":        { "active": "builtin", "list": [ … ] },
  "ack":        { "active": "builtin", "list": [ … ] },
  "getloop":    { "active": "builtin", "list": [ … ] }
}
```

三条约定：

- **一个文件装 8 段**，不拆 8 个文件：`active` + `list` 是「每区块一条记录」的整体，拆开后播种要重新组装，多一道会写错的拼装；`getloop` 一段当前有两个常量（指令 + 模板），拆文件还得先裁决谁进 JSON。
- **`template` 存单个字符串（含 `\n`）**，不存行数组：DB 里就是单字符串，JSON 存数组会多一次 `join`，多一个可能不一致的环节。
- **文件里没有版本号**：版本存 `settings['lt.promptTemplatesVersion']`，否则「文件 ≡ DB 行」这条性质当场破掉。

### 2.1 8 段一览

| order 默认位 | id | label | 何时输出 | 写回 | 可见变量（`schema.fields`） |
|---|---|---|---|---|---|
| 10 | `context` | 组 / 项目上下文 | 每次 | `repo` `group` `refRepos` | repo.*, group.*, refRepos.*, cwd |
| 20 | `attachment` | 附件识别 | 任务带附件 | `attach` | attach.* |
| 30 | `timecheck` | 时间目标检查 | 任务带时间目标 | — | goal.* |
| 40 | `goalhint` | 特殊功能提示 | 任务带时间目标 | — | goal.* |
| 50 | `doneguard` | 完成门禁 | blocked 返回路径 | — | goal.* |
| 60 | `ext` | 待领取队列 | 同主题尚有待领取 | `ext` | ext.* |
| 70 | `ack` | 完成总结指令 | 每次 | — | task.* |
| 80 | `getloop` | 持续 get | 项目开启持续 get | `getloop` | getloop.* |

`task` / `cwd` / `goal` 由 `compose()` 的 `seed` 传入，不是插件——它们没有输出段落，也就没有 order 位。段落集合与当前 `BLOCK_DEFS` **完全一致**，blockId 即插件 id。

**模板正文不进本文件**（本文档也不复制）：正文的唯一位置是 `blockTemplates.json`。文档里再抄一份就是第二份真相。

---

## 3. 首启落库与升级（唯一写点）

```
bin/kv.mjs                       ← tsx 直接跑 src 源码（不是 dist）
 └ openStore()                   ← core/db：建表 / 迁移 / seedBuiltinTemplates（templates 表，不碰 blockTemplates）
 └ ensurePromptTemplates()       ← runtime 启动调用，全仓唯一调用点
      ├ 读 settings['lt.promptTemplatesVersion']，缺省视为 0
      ├ 已是最新 → 直接返回（重启零写、零查询）
      └ 落后 →
           · 读 Template/blockTemplates.json（fs + import.meta.url 相对路径）
           · 逐区块把 builtin 条目的 template 换成 bundle 文本
             （用户条目 builtin:false、active、list 顺序一律不动）
           · 同事务写回 lt.blockTemplates 与 lt.promptTemplatesVersion
 └ 分发命令
```

**为什么调用点在 runtime 而不是 `core/db/bootstrap.ts`**：`core` 不许 import `modules`/`shared`（`eslint.config.js:149-166`），模块之间也不许互相依赖（`eslint.config.js:167-207`）。模板 JSON 按约定放在模块下，因此只有 runtime 装配层能合法引用；写库直接用 `writeSettingRaw`（`src/core/db/settings.ts:32`），不新增任何模块互依。

**升级语义只有一条**：`version` 落后时**只覆盖内置文本**。用户自建条目与 `active` 永不被覆盖——这与 `templates` 表「builtin 标记不覆盖用户编辑」的既有裁决同向。

**读不到 JSON 即报错**，不降级：打包少文件是发布事故，静默降级会让所有段空掉却零告警。

---

## 4. 读路径与写路径

### 4.1 读：只校验，不合成

`normalizeBlockTemplateLists(raw)`（`src/shared/prompt-blocks.ts:389`）改为纯校验：

- 输入必须是 `{ [blockId]: { active, list } }`，8 个 id 齐全；缺一个即抛出（说明库没被播种或被人为清空——属事故，不补齐）。
- 列表里恰好一条 `builtin`；`template` 非空、≤8000 字；用户条目按 id 去重、每块 ≤20 条。
- `active` 指向不存在的条目 → 回落 `builtin`（这是唯一的回落，且不是兼容，是数据自愈）。

**删除**：`builtinItemOf` 按代码重建 builtin（`:397` 那个 `continue`）、稀疏补齐、`{ [blockId]: [...] }` 简写、旧键一次性折算、`rule` 键并入 `ack`。落库之后这些都没有存在理由。

### 4.2 写：内置不可改在这里挡

`setLtSettings`（`src/modules/localtask/repo/settings.ts:332`）保存时：

1. 忽略对 `builtin` 条目的任何改动（列表里那条恒等于库内现值）；
2. 每个区块至少一条可用模板；
3. 模板文本过 `validateTemplate`（语法）+ **变量白名单**（`{{x.y}}` 的 `x` 必须落在该插件 `writes ∪ seed` 里，`y` 必须是 `schema.fields` 里声明过的键）；
4. 不通过就拒绝保存，并把未声明变量列出来。

「内置不可改」从读路径挪到写路径，是因为落库后 builtin 是真数据：读路径改写它，就会出现「库里存 A、渲染用 B」。

---

## 5. 顺序

### 5.1 唯一真相是数组

```
settings['prompt.pluginOrder'] = ["context","attachment","timecheck","goalhint","doneguard","ext","ack","getloop"]
```

- `abstract order` 只是**播种默认位**：数组不存在时用它生成一次，此后不再读；
- 运行期 `effectiveOrder = index × 10`，永远从数组派生；
- 因为 order 不是存储值，拖动天然没有「怎么分配 / gap 不够 / 两个相等」三个分支；
- 校验不变量一条：数组恰好包含全部插件 id 各一次、无未知 id；不合法即按默认位重建（加载期单点修复，运行期仍是直线）。

### 5.2 拖动交互

复用仓库已验证的手法（md 编辑器 `use-block-drag`：`dragover` 上/下半区判落点 + 插入线），零新依赖。`drop` → 重排数组 → `PUT /api/prompt/order` → 重新 `GET` 刷新。不提供数字输入框——数字输入是「相等 / gap」这两个分支的唯一来源。

### 5.3 对外接口（三端同源）

| 出口 | 形态 |
|---|---|
| `nx-kv prompt registry` | `GET /api/prompt/registry`：`uidDescriptor()` 的 JSON |
| `nx-kv prompt order` | `PUT /api/prompt/order`：写数组 |
| `nx-kv prompt reset --block <id>` | 把某区块 builtin 恢复为 bundle 文本（S3 再加，接口位先留） |

---

## 6. 编排 `compose()`

```ts
export interface ComposeOptions {
  plugins: readonly AnyPromptPlugin[];
  orderIds: readonly string[];          // 顺序数组（唯一真相）
  templates: Record<string, { template: string }>;   // lt.blockTemplates 归一化后的生效项
  seed?: Record<string, unknown>;       // { task, cwd, goal }
}

export async function compose(opts: ComposeOptions): Promise<string> {
  const { plugins, orderIds, templates, seed = {} } = opts;
  assertPluginList(plugins);
  assertOrder(plugins, orderIds);                    // 恰含全部 id 各一次

  const byId = new Map(plugins.map((p) => [p.id, p] as const));
  const ordered = orderIds.map((id) => byId.get(id)!);

  const ctx: Record<string, unknown> = { ...seed };
  for (const p of ordered) Object.assign(ctx, await p.get('data'));   // ① 结构态

  const parts: string[] = [];
  for (const p of ordered) {
    const text = renderInstruction(templates[p.id]!.template, ctx).trim();  // ② 文本态
    if (!text) continue;                                                     // ③ 唯一「不出段」规则
    parts.push(text);
  }
  return `<nx-kv>\n${parts.join('\n')}\n</nx-kv>`;                          // ④
}
```

四种语义各只有一处答案：

| 关注点 | 唯一答案 |
|---|---|
| 顺序 | `orderIds`（不 sort、无 tie-break） |
| ctx 合并 | 按顺序 `Object.assign`，段级命名互斥由 `assertPluginList` 保证 |
| 是否出段 | 渲染结果 `trim()` 为空即不出（模板为空 → 启动期已报错，到不了这里） |
| 失败 | `data()` 抛错 = 整次领取失败，不吞、不回落 |

`composeSystemBlocks` 里的双层 `try/catch`（`system-blocks.ts:82` / `:92`：坏模板回落内置 → 再失败给空串）**删除**。理由：模板已在保存期校验语法与变量，运行期抛错只可能是代码 bug；静默回落会让「提示词少了半段」变成无人知晓的常态。

---

## 7. UI 由声明派生

```ts
// src/shared/prompt-plugin.ts
export interface PluginUIDescriptor {
  id: string;
  order: number;                            // 数组下标 × 10
  label: string;
  template: string;                         // 文本态 → 模板编辑区初值
  fields: readonly FieldDecl[];             // 插入变量目录
  writableKeys: readonly string[];          // 参数表单只为这些生成控件
}

export function uiDescriptor(plugins: readonly AnyPromptPlugin[], orderIds: readonly string[]): PluginUIDescriptor[] {
  const byId = new Map(plugins.map((p) => [p.id, p] as const));
  return orderIds.map((id, i) => {
    const p = byId.get(id)!;
    return { id: p.id, order: (i + 1) * 10, label: p.label,
             template: p.get(), fields: p.schema.fields, writableKeys: p.writes };
  });
}
```

控件映射（纯函数，`FieldKind` → 控件，无手写第二份）：

| kind | 控件 |
|---|---|
| `string` | 单行输入 |
| `text` | 多行文本域 |
| `number` | 数字输入 |
| `boolean` | 开关 |
| `enum` | 下拉（选项来自 `enumValues`） |
| `list` | 只读表格 + 复制按钮（值由 `data()` 提供） |

`fields` 不再手写：由 `schema-bridge.ts` 从 zod shape 派生（§1.4 映射表），kind 六值与上表一一对应；`writableKeys` 即 `writes`。UI 的改动量因此不变——变的只是这份目录的**来源**（手写声明 → schema 派生）。

只手写三处，因为它们价值在交互密度而不在字段数量：**模板编辑器**（含插入变量下拉）、**实时预览**（`compose()` 同一函数出结果）、**注册表调试页**（拖动排序 + 校验结果）。

**删除** `src/web/frontend/modules/prompts/placeholders.ts`（手工副本，头注释还在讲引擎早已废弃的 `{{#goal}}…{{/goal}}` 语法）与 `page/settings/prompt-template-params.ts`（手写参数速查表）——两者都由 `uiDescriptor()` 派生。

---

## 8. 目录结构（最终）

```
src/shared/prompt-plugin.ts                 FieldDecl / PluginSchema / uiDescriptor / assertPluginList / assertOrder（纯类型 + 纯函数）
src/modules/promptplug/
  Template/blockTemplates.json              出厂快照（8 段，与 DB 行逐字同形）
  base.ts                                   PromptPlugin 基类（get 双态唯一实现 + get('data') 出口 safeParse）
  schema-bridge.ts                          zod shape → PluginSchema / FieldDecl / blank（仿 runtime/zod-bridge.ts）
  plugins/
    context.ts        order 10  写 repo / group / refRepos
    attachment.ts     order 20  写 attach
    timecheck.ts      order 30  只读 goal
    goalhint.ts       order 40  只读 goal
    doneguard.ts      order 50  只读 goal
    ext.ts            order 60  写 ext
    ack.ts            order 70  只读 task
    getloop.ts        order 80  写 getloop
  template-bundle.ts                        读 Template/blockTemplates.json + 形状校验
  ensure.ts                                 首启落库 / 版本合并（唯一写点）
  order.ts                                  prompt.pluginOrder 读写 + 不变量校验
  compose.ts                                编排（§6）
  index.ts                                  装配：插件数组 + 对外函数
src/runtime/…                               启动调用 ensurePromptTemplates()；挂 prompt 命令与 /api/prompt/*
src/web/frontend/page/settings/prompt-templates-section.tsx   改写：拖动列表 + 模板编辑 + 预览
```

分层依据（都是既有规则，不是新约定）：`shared` 零依赖 → 只放纯类型与纯函数；`modules` 做 I/O 与编排；`core` 只提供 `renderInstruction` / `writeSettingRaw` 这类基础设施；`web` 只通过 `/api` 取数据。

---

## 9. 现有实现的处置

### 9.1 删除

| 对象 | 位置 | 原因 |
|---|---|---|
| `DEFAULT_CONTEXT_TEMPLATE` 等 9 个常量 | `shared/prompt-blocks.ts:67/138/165/184/199/212/224/243/250` | 正文迁到 `blockTemplates.json` |
| `BlockDef.defaultTemplate` 字段与 `BLOCK_DEFS` | `:271` / `:283` | 段落清单改由插件数组提供 |
| `builtinItemOf` 的「按代码重建 builtin」 | `:397` | 落库后 builtin 即真数据 |
| `buildDeliveryCtx` / `deliveryCtxOf`（约 80 行硬编码聚合） | `tasktool/delivery-template.ts:203` / `:101` | 拆进各插件 `data()` |
| `composeSystemBlocks` 的双层 try/catch | `tasktool/system-blocks.ts:82` / `:92` | 运行期不兜底 |
| 旧 settings 键折算、`rule` 并入 ack、`{blockId:[...]}` 简写、稀疏补齐 | `localtask/repo/settings.ts:178`（`migrateLegacy`）/ `:128`（`mergeRuleIntoAck`）/ `:154`（`absorbStoredRule`） | 落库后无兼容对象 |
| 前端 `placeholders.ts`、`prompt-template-params.ts` | 前端 modules / page | 由 `uiDescriptor()` 派生 |

### 9.2 改写

| 对象 | 改成 |
|---|---|
| `normalizeBlockTemplateLists` | 纯校验（§4.1） |
| `setLtSettings` | 内置写保护 + 白名单校验（§4.2） |
| `resolveBlockTemplates` | 保留，输入从 DB 读，输出仍是「每段生效模板」 |
| `tasktool/plugins/runtime.ts` | `timegoal` / `waitgoal` 的名字硬编码（`:32` / `:37` / `:69`）保持不变——那是领取期 hook 插件，与本方案的交付期上下文插件是两个生命周期，不合并 |
| `system-blocks.ts` | 改调 `compose()`，自身只剩「取 templates + 调 compose」 |

### 9.3 新增

`Template/blockTemplates.json`、`base.ts`、`schema-bridge.ts`、8 个 `plugins/*.ts`、`template-bundle.ts`、`ensure.ts`、`order.ts`、`compose.ts`、`index.ts`、`shared/prompt-plugin.ts`、settings 键 `lt.promptTemplatesVersion` 与 `prompt.pluginOrder`、runtime 启动一行、`prompt` 三个 action、前端拖动列表组件、4 个单测文件。

---

## 10. 落地顺序与验收

每一步都以「输出不变」为验收，改造期间不允许出现两份实现并行运行。

| 步 | 内容 | 验收 |
|---|---|---|
| **S0** | 建 golden：用当前实现在 10 条固定 ctx（含 repo/group/refRepos、附件、时间目标、ext、getloop 各一）上渲染，存成 `tests/unit/__golden__/prompt-instruction/*.txt` | `pnpm test:unit` 绿 |
| **S1** | 抽 `PromptPlugin` 基类 + 8 个插件，`data()` 搬 `buildDeliveryCtx` / `deliveryCtxOf` 的逻辑；`compose()` 替换 `composeSystemBlocks` 主体 | 10 条 golden **逐字节相同** |
| **S2** | 模板资产化：`Template/blockTemplates.json` + `template-bundle.ts` + `ensure.ts` + 版本键；`normalize` 去合成；`setLtSettings` 加写保护 | 首启落库一次；重启零写；升级只刷 builtin |
| **S3** | 注册表外露：`GET /api/prompt/registry`、`PUT /api/prompt/order`、`nx-kv prompt registry/order/reset`；删 `placeholders.ts` 与参数速查表 | CLI 输出与 API 输出同源同一份；前端不再有手工副本 |
| **S4** | 设置页：拖动排序 + 模板编辑 + 实时预览 | 拖动后 CLI 渲染顺序同步变化；坏模板保存被拒并列出未声明变量 |

每步收尾跑 `pnpm test`（lint + typecheck + build + smoke + unit）。S1 的 golden 是硬门槛：字节不一致就是语义变了，必须解释到行为差异为止，不许「看着差不多」放行。

---

## 11. 非目标（明确不做，逐条一句话）

- **不做旧配置兼容**：旧 `lt.*` 键、`rule` 键、数组简写形态在 S2 全部删除，不做读取折算。
- **不做稀疏补齐**：8 段必须齐全，缺段即报错，不用代码补。
- **不做运行期模板回落**：坏模板在保存期拦下，运行期抛错即失败。
- **不做多份段落清单**：没有 `blockIds` 清单、没有 YAML 清单，顺序只有数组。
- **不做 YAML**：真相在 DB；若将来需要搬运，YAML 只能是导入/导出格式。
- **不做外部第三方插件包 / 热插拔 / WASM 沙箱**：插件是仓内代码；单进程启动 <1s，状态一致性成本大于收益。
- **不做 per-repo provider 配置**：`data()` 里已能拿到 `cwd` 与仓库上下文，读哪一层由插件自己决定。
- **不做 ChatML / `Message[]` / function calling**：交付物是给 agent 读的类 XML 文本；工具面就是 CLI 本身，将来要暴露直接对齐 MCP。
- **不做 `priority` / `stage` / `requires` / 拓扑 / `when()` / `failOpen` / `timeoutMs`**：顺序靠数组，出段靠模板空不空，失败靠抛出。
- **不保留 `builtin` 特判**：内置就是插件数组里的前 8 项，没有 `if (id === 'builtin')`。

---

## 12. 现状证据（施工时对照，均为当前代码实测行号）

| 事实 | 证据 |
|---|---|
| 8 段默认模板是 TS 常量，不是 YAML | `shared/prompt-blocks.ts:67/138/165/184/199/212/224/243/250` |
| 段落清单是静态数组，无 order 字段 | `shared/prompt-blocks.ts:283`（`BLOCK_DEFS`） |
| ctx 由约 80 行硬编码聚合 | `tasktool/delivery-template.ts:101`（`deliveryCtxOf`）、`:203`（`buildDeliveryCtx`） |
| 渲染出块靠「渲染成空串 + continue」 | `tasktool/system-blocks.ts:77` 一带 |
| 坏模板双层回落（内置 → 空串） | `tasktool/system-blocks.ts:82` / `:92` |
| 用户覆盖存 settings 一行 JSON | `localtask/repo/settings.ts:51`（key）、`:241`（读）、`:332`（写） |
| 内置条目按代码重建、输入里的 builtin 被丢弃 | `shared/prompt-blocks.ts:389` / `:397` |
| `core` 不得 import modules/shared | `eslint.config.js:149-166` |
| 模块之间不得互相依赖 | `eslint.config.js:167-207` |
| shared 零依赖（第三方包进不了这里） | `eslint.config.js:213-220`（「碰第三方包就进不了 Node」注释） |
| zod ^4.6.7 已是正式依赖 | `package.json` dependencies |
| action 契约已全面用 zod：声明 + 泛型推导 | `modules/localtask/actions/localtask-add.ts:40`（`const input = z.object`）、`ActionBase<typeof input>` |
| zod → 字段说明 / 类型树 映射的现成先例 | `runtime/zod-bridge.ts:107`（`describeInput`）、`:231`（`describeOutput`） |
| 「zod 能替代校验，替代不了归一化」+ `_zod.def` 内部 API 警戒 | `runtime/zod-bridge.ts:3-14` 头注释、`:44`（`unwrap`） |
| contract IR 不碰 zod 的既有裁决 | `runtime/zod-bridge.ts:204-210`（IR JSON 安全，生成器只认它） |
| settings 原始读写不经过 localtask | `core/db/settings.ts:21` / `:32` |
| 打包与运行形态 | `package.json.files` 含 `src/`；`bin/kv.mjs` 用 tsx 跑 **src 源码**（非 dist） |
