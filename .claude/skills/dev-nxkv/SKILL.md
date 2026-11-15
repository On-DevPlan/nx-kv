---
name: "dev-nxkv"
description: "nx-kv 仓库的按需求分类动作手册。R 需求原型（加资源/附件类型、加改命令与业务规则、改面板交互、加面板页面、改提示词交付、发版、排障定位、查库改数据、改编排闸门、校准本手册）+ P 原语（迁移决策、action 形态、契约生成、面板探针、交付门禁）。触发词：改 nx-kv、加一种附件类型、扩展附件类型、attachments kind、加命令、加接口、加 action、改业务逻辑、改判定、改事务、改错误码、改面板、改交互、修 UI、按钮点不动、白屏、快捷键、加页面、加面板、改前端、改样式、改提示词、改模板、模板变量、发版、CHANGELOG、打 tag、升版本、契约、gen:dart、报错、排障、找不到代码、定位代码、查数据库、改数据、备份恢复、任务依赖、闸门、编排、状态机、ready 判定、SOP 过期、校准 skill、dev-nxkv。仅用 nx-kv 领任务/提交任务时不要用本 skill。"
---

# dev-nxkv — 按需求分的 SOP 集

本文件**只做路由**。R = 需求原型（一张任务单的第一跳，端到端走完）；P = 原语（被多条 R 引用的机械序列，不是入口）。

## 第 0 步：判需求原型（一次判定，别跳）

| 任务在问什么 | SOP |
|---|---|
| 让系统认识一种新东西（附件类型 / 资料 / 路径指针 / 新 kind） | R01 |
| 要一个新命令/接口，或改某条命令的行为与判定 | R02 |
| 面板上某个交互不对：按钮、快捷键、样式、白屏 | R03 |
| 要一个新页面 / 新面板 / 新板块 | R04 |
| 要改交付给 agent 的提示词、区块模板、变量 | R05 |
| 要发版：版本号、CHANGELOG、契约、tag、对外文档 | R06 |
| 只有现象没有位置：报错、404、找不到代码在哪 | R07 |
| 要查库、修本机数据、备份恢复 | R08 |
| 要改任务依赖、闸门、编排、状态机 | R09 |
| dev skill 本身过期了、要加/修 SOP | R10 |

判不了 → R07（先定位；定位完它会告诉你去哪条 R）。天然跨层的需求（如 R01），
条目内部已按 库 → server → 前端 排好子步骤，机械部分引用 P 完成。

## R · 需求原型（入口）

| SOP | 一句话 |
|---|---|
| `R01-加一种资源类型.md` | 加一种附件/资源 kind：迁移 → 登记 → 模板（序列化+知识化）→ 附件区 → 说明书与测试 |
| `R02-加或改命令与业务规则.md` | 加一条命令/接口，或改 service 的判定、事务、错误语义、派生字段 |
| `R03-改面板交互.md` | 改既有页面的交互/组件/样式；探针实测是强制环节 |
| `R04-加面板页面.md` | 加页面/面板：一个目录 + 四处登记 + 路由逐字互逆 |
| `R05-改提示词交付.md` | 改交付提示词/区块模板/渲染链；保存期校验 + 运行期回落 |
| `R06-发版.md` | 定级 → CHANGELOG → 契约重生成 → 对外收口 → push → CI 发布 |
| `R07-排障与定位.md` | 现象 → 四步定位 → 四条定位链 → 症状速查 → 转具体 R |
| `R08-查库与改数据.md` | 只读查询 / 现成命令优先 / 备份再动手 |
| `R09-改编排闸门.md` | 任务依赖 / DAG / ready 判定 / 状态机 / 事件 |
| `R10-校准skill.md` | 本手册的现读现写校准与加 SOP 规矩 |

## P · 原语（被引用，不是入口）

| 原语 | 内容 | 被谁引用 |
|---|---|---|
| `P01-迁移与决策.md` | 建表/改列/设置键、12-step 重建、`@decision`、迁移边、版本说明 | R01 R02 R08 R09 |
| `P02-action形态与事务.md` | action 骨架、zod 内联、service/repo 分层、`tx`/`withTopicMutator` | R01 R02 R09 |
| `P03-契约生成.md` | `pnpm gen`/`gen:dart`、contract guard 四条底线 | R01 R02 R06 |
| `P04-面板探针.md` | 隔离 store、临时端口、Playwright 坑位表 | R01 R03 R04 R07 |
| `P05-交付门禁与提交.md` | 五道 lint、typecheck/test/build、汇报六问、提交规矩 | 所有 R 收尾 |

## 五条全局门禁（每条 SOP 收尾都过）

1. **全仓 TS**：源码只有 `.ts` / `.tsx`；import 路径**保留 `.js` / `.jsx` 后缀**，loader 解析到同名 TS 文件。
2. **一条 action 一个文件**：`src/modules/<id>/actions/<cli首词>-<动词>.ts`，`@action` + zod 契约内联 + 方法名 `run`；`cli` 必须有，`http` 可为 `null`。改完 `pnpm gen`，并**重启 serve**。
3. **schema 只加不改**：新迁移 `vN+1.sql`（已发布快照不可变）+ `DIRECT_EDGES` 登记边 + 每张 `CREATE/DROP TABLE` 前一行 `-- @decision docs/decisions/<文件>.md` 且该文件真实存在。
4. **前端只走 HTTP**：禁止 import `modules/` `runtime/` `core/`，只能用 `src/shared/`；页面不裸调 `api()`，收口到 `page/<name>/api.ts`。
5. **测试不碰真实库**：一律 `tests/support/test-store.mjs` 的临时库；动真实库前先 `node bin/kv.mjs db backup`。

## 事实现查（不要记数字、不要信旧文档）

```powershell
node bin/kv.mjs routes                      # 全部命令 ↔ 路由（条数以输出为准）
node bin/kv.mjs routes --module <id>        # 某模块有哪些入口
node bin/kv.mjs help --json                 # 可解析的命令表
grep -n CURRENT_SCHEMA_VERSION src/core/db/version.ts   # schema 版本
ls src/core/db/migrations/*.sql             # 迁移到尾号
ls src/modules/                             # 现存模块（历史模块会被删）
pnpm run                                     # 全部脚本（lint/typecheck/build/test…）
```

## 序列约定（`pnpm lint` 强制）

- 文件名固定 `<序列><两位序号>-<动作>.md`，序列只有 `R`（需求原型，任务的第一跳）/ `P`（原语，被引用的机械序列）。
- R 是端到端入口，P 单点维护机械细节：R 里**引用** P，不复制内容——否则 10 条垂直 SOP 会膨胀回知识库（#202 之前曾膨胀到 2735 行，被门禁拦回）。
- 新增 SOP 必须挂进上面的表并被本文件路由；**R、P 各至少一条**，否则门禁失败。
- SOP 里的路径与 `node bin/kv.mjs <cmd>` 都会被逐条核对——写错路径、写不存在的命令，lint 直接拦。

> 本 skill 记的是**动作**，代码是唯一真相。步骤里的路径不存在时，先跑 `R07-排障与定位.md` 重新定位，再按 `R10-校准skill.md` 回写。
