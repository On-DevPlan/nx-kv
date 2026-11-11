# #177 · 第 3 轮：action 输入参数泛型化（base 基类泛型模板）

## 验收反馈（本轮目标）

> 当前对于 action 其中的输入参数需要泛型，通过在 base 基类定义泛型模板去自动化。

## 现状痛点（动手前）

- 154 个 action 类形态高度统一：一类一文件、全 `extends ActionBase`、恰好一个 `@action` 方法。
- 入参类型两种写法并存：`z.output<typeof xxxInput>` 手写（system 3 条）与 `ctx: any`
  （迁移器生成的 151 条）——后者是全项目 any 警告的主要来源。

## 设计：`ActionBase<TInput>` 泛型模板

```ts
// src/runtime/action-base.ts
export type ActionInput<S extends ZodType> = z.output<S>;
export interface ActionRunMeta { transport?: string }

export abstract class ActionBase<TInput extends ZodType = ZodType> {
  declare readonly _input: TInput;                       // 幻影字段（仅类型层）
  constructor(protected readonly deps: Container) {}
  abstract run(input: z.output<TInput>, meta?: ActionRunMeta): unknown;
}
```

子类形态（**方法名固定 `run`**，注解全项目统一）：

```ts
export class XAction extends ActionBase<typeof xInput> {
  @action({ id: 'x.do', cli: [...], http: [...], summary: '…', input: xInput })
  override async run(ctx: ActionInput<this['_input']>) { … }
}
```

### 实测结论（决定了最终形态）

TS 对**类成员声明**没有任何上下文类型注入通路，三条都试过：

| 尝试 | 结果 |
|---|---|
| override 基类方法、不写注解 | ❌ 隐式 any（TS 不从基类取 override 参数类型） |
| TC39 装饰器约束方法签名 | ❌ 推不出 F，且 this 依赖类型出了类声明不可解析 → 每个应用点报「装饰器签名无法解析」 |
| **`this['_input']` 幻影字段 + 统一注解** | ✅ 类型从类上的 `TInput` 推导，schema 只声明一次 |

- 注解因此**不能省**（`ActionInput<this['_input']>` 是唯一可写通路），但它是**全项目统一
  的样板**，不再重述 schema 结构，也不再落 any。
- `@action` 退回纯元数据收集（`value: any` 透传），不再做类型层对账——this 依赖类型做不到。
- 出参仍是「实现即契约」：codegen 从方法签名读返回类型，未变。

## 机械迁移（154 文件）

- `extends ActionBase` → `extends ActionBase<typeof <schemaName>>`（schema 名取自文件头 import）。
- 方法统一改名 `run`，去掉 `ctx: any` / `z.output<…>` 注解，改写统一注解。
- 8 个读 `transport` 的 action 第二参写 `opts: ActionRunMeta = {}`。
- 2 个 stream action（`file.content` / `localtask.events`）局部展开 `input.__raw`
  （ApiRouter 在 parse 之后注入，不在公共契约 schema 里）。
- codemod 一次性跑完（temp/ 下，不入库）；`pnpm gen` 重出 client.generated.ts（`['run']`）。

### 类型化顺带抓出的 6 处真实错位（行为未变，逐一留注释）

zod object 会**剥掉未声明键**，于是这些读取恒为 undefined（CLI 与生成的 client 都只发
已声明键，故不是活 bug，但也是「迁移器留下的死路径」）：`localtask.config` 的 camel 读法、
`localtask.importRemote` 的 `refs`、`localtask.reopen` 的 `attachments`、
`board.import` 的 `json`。修法一律**保持运行期行为不变**（收敛到 kebab 或局部 cast + 注释），
是否给 schema 补键（复活这些路径）留给发布方裁决。

## 约束

- 纯类型层重构 + 方法改名（runtime 分派走 run 闭包，方法名不外泄）：不改业务语义，
  全套测试兜底（smoke 194 / unit 906）。
- 不碰并行会话的工作区文件（eslint.config.js / page/* / 各页 api.ts）。

## 验证

- `tsc -b tsconfig.node.json`：0 错误（strict）。
- web 侧：`client.generated.ts` 及其传递依赖单独编译 0 错误（整 web 工程当时被并行
  会话的 #176 前端中间态挡住，已与对方协调）。
- `eslint`（改动路径）：0 error。
- `pnpm test:unit`：906/906；`pnpm test:smoke`：194/194。

## 交付

- commit + push origin main；CHANGELOG [0.48.1]；package.json patch+1。
- 同步 skill：dev-nxkv B01/B03（新增 §0.5 模板形态）、system/schemas.ts 头注。
- 收尾：`localtask done --id 177` → `localtask wait`（本轮最后一步）。
