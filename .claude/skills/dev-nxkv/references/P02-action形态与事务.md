# P02 · 原语 · action 形态与事务规矩

> 被 `R01-加一种资源类型.md`、`R02-加或改命令与业务规则.md`、`R09-改编排闸门.md` 引用。
> 一条 action 一个文件、zod 契约内联、业务进 service、SQL 进 repo、事务有唯一写入口。

## ① 前置（先跑，拿事实）

```powershell
ls src/modules/<模块>/actions/                    # 命名与骨架
cat src/modules/<模块>/actions/<最相近的>.ts      # 照抄这一份，不要照抄本文
cat src/modules/<模块>/service.ts                 # 现有函数风格
ls src/modules/<模块>/repo/                       # SQL 只在 repo/*.ts
```

## ② 动作：action 骨架（字段顺序与真实文件保持一致）

文件名 `src/modules/<模块>/actions/<cli首词>-<动词>.ts`，命名照现有文件
（`board-list.ts`、`localtask-preview.ts`；一段式命令用 `<动词>.ts`，如 `system/health.ts`）：

```ts
// <module>.<verb> —— 一句话作用（review 的人先看这行）
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

/** 入参契约（CLI 与 HTTP 共用同一份）。`.describe()` 就是 help 文本。 */
const input = z.object({
  cwd: z.string().optional().describe('目标目录，缺省 = 进程当前目录'),
});

export class XxxAction extends ActionBase<typeof input> {
  @action({
    id: '<module>.<verb>',        // 全局唯一
    cli: ['<首词>', '<动词>'],     // 必须有；不得与 routes 里已有路径重复
    http: ['POST', '/api/xxx'],   // 纯 CLI 写 null
    summary: '一句话（出现在 help）',
    input,
    // 需要人类可读输出时加：render: (d) => service.renderXxx(d)
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.doSomething(ctx);   // run 只做编排，业务在 service
  }
}
```

- **不要**自己处理 `--json` / `--xml`——那是 `src/runtime/cli.ts` 的全局开关（`splitGlobals`），返回对象即被序列化。
- `render` 只在**默认输出**要好看时才加；不加就走 JSON 打印。
- `id` 与 `cli` 都由 `src/runtime/registry.ts` 在启动时自检重复，重复会直接启动失败。

## ③ 动作：service / repo / 事务

- 业务规则、事务边界、错误语义在 `service.ts`；错误用 `src/core/errors.ts` 的
  `badInput` / `notFound` / `conflict`，不要 `throw new Error(...)`（错误码会退化成 500/1）。
- 多表写入必须包事务：通用模块用 `src/core/db/tx.ts` 的 `tx((db) => …)`；
  `localtask` 的仓储层用自己的 `txw()`（`src/modules/localtask/repo/open.ts`）。
  **回调保持同步，不要 `await` 非同步 IO**（`tx` 会直接抛 `TypeError`）——
  需要 `await` 的（git/fs/网络）在事务外先取。
- `localtask` 域：**所有 `tasks` / `topics` 写入必须经 `withTopicMutator`**
  （`src/modules/localtask/writes.ts`，grep `withTopicMutator` 看用法）——
  它负责派生字段、事件、快照同步，绕过就是静默不一致。
- **派生字段不手写**：任务 DAG、`ready`、`blockBy` 的另一侧由 `syncNewTaskDag` /
  `syncTaskDagUpdate` / `markTaskSuccess` 维护，改行为时同步改它们而不是在调用方补 UPDATE。
- 时间统一 `nowMs()`（`src/core/db/time.ts`），不写 `Date.now()`。
- Node 与浏览器都要用的纯计算放 `src/shared/`（纯函数、零依赖、无 IO）。

## ④ 自检（形状层面）

| 检查 | 命令/判据 |
|---|---|
| 注册唯一 | `node bin/kv.mjs routes --module <模块>` 无重复、无启动报错 |
| 契约自检 | `node --import tsx --test tests/unit/registry.test.mjs` 通过 |
| 唯一实现 | 同一判断只存在一处（`grep` 复核） |

## ⑤ 失败分支（形状层面）

| 症状 | 原因 | 处置 |
|---|---|---|
| 启动报「命令重复」 | `cli` 与既有路径撞了 | `node bin/kv.mjs routes` 找出占用者，改名或复用 |
| `pnpm typecheck` 报找不到模块 | 写了 `.ts` 后缀 | import 一律写 `.js` 后缀（见 SKILL 门禁 1） |
| `tx` 抛 `TypeError` | 回调返回了 Promise（里面有 `await`） | 事务外取数据，事务内只做同步写 |
| 写入成功但派生字段没更新 | 绕过了 `withTopicMutator` | 改回唯一写入口 |
| `run` 里写业务导致难测 | 逻辑压在 action 层 | 挪进 `service.ts`，action 只编排 |

## ⑥ 反模式（见到就改）

- 一个文件里塞多条 action（模板形态固定一条一文件，`gen:actions` 只认这种）。
- `run` 里直接拼 SQL。
- 在 SQL 里写业务判断（「完成则 ready」这类属于纯函数层）。
- 同一个规则在 service、repo、前端各写一遍。
- 为了方便在 `repo/*.ts` 里顺手 `await` 外部 IO（事务边界会被打穿）。
- 为了「以后可能用到」加可选参数却不写 `.describe()`——help 会变成空白说明。
