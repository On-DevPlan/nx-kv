# #178 · 第 4 轮：schema 内联进 action（去掉独立 schemas.ts，基类封装类型）

## 验收反馈（本轮目标）

> 不要单独的 schema 文件作为运行时契约 内联在 action 中 基类类型封装

## 现状

- 154 个 action 的 zod 契约都放在同域 `schemas.ts`（12 个文件，1201 行），
  action 文件用 `import { xxxInput } from '../schemas.js'` 取。
- codegen 靠**命名约定** `<camelCase(actionId)>Input` 拼 import 名——
  约定破了会生成指向不存在符号的代码（schemas.ts 头注里自己写的风险）。
- 本仓 schema 与 action 是干净的 1:1：154 常量 ↔ 154 文件，无共用、无未用。

## 设计

### 1. 契约内联（删掉 12 个 schemas.ts）

每个 action 文件自带自己的契约，模块私有、就在类上方：

```ts
import { z } from 'zod';
...
/** localtask.get 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({ id: z.number().optional(), ... });

export class LocaltaskGetAction extends ActionBase<typeof input> {
  @action({ id: 'localtask.get', ..., input })
  override async run(ctx: ActionInput<this['_input']>) { ... }
}
```

- 命名统一为 `input`：一文件一契约，文件名已给出上下文；`input,` 还能用对象简写。
- schema 内容**逐字保留**（`.describe()` 是 CLI 用法串与帮助文本的来源，动了就是改口径）。

### 2. 基类封装类型（codegen 不再认识 schema 常量）

前端 apiclient 的入参类型改为**从 action 类反推**，不再 import schema 常量：

```ts
// 旧：z.input<typeof localtaskGetInput>（依赖命名约定 + schemas.ts 路径）
// 新：z.input<InstanceType<typeof LocaltaskGetAction>['_input']>
```

- `_input` 幻影字段（#177 引入）挂在基类上 → 类型经**基类泛型**流到前端，
  契约常量从「可被引用的符号」降级为「文件内的实现细节」。
- 顺带删掉 `schemaName()` 命名约定（只被 codegen 自己用，测试无依赖）。
- 生成物少 10 组 schema import，前端不再 import 后端契约文件。

## 约束

- 纯结构调整：契约**内容与位置语义**不变（`describeInput` 仍按同一 schema 算字段、
  用法串、help 文案）。行为差异须有测试兜底。
- 不碰并行会话（nx-kv-9a 的 #176 前端页���）的文件。

## 验证

`pnpm gen` 新鲜度 → `tsc -b tsconfig.node.json` 0 错误 → client.generated 及传递依赖
web 编译 0 错误 → eslint 0 error → unit 906 / smoke 194 → 提交 + push。
